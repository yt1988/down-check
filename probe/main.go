// down-probe: measures every service in services.json from this machine, one request each, every 10 minutes, and
// writes latest.json (and days/YYYY-MM-DD.json below it). Run it from one machine per place: the `from` label is what
// the page shows, and each machine's file stands on its own — the Worker merges Tokyo and Shanghai without combining
// them into one number.
//
// The output is per service: the latest result, its own measurement time t, a compact history h (oldest first:
// o answered, u could not be confirmed (403/429/challenge), x no answer, - not measured), uptime over 24 h and 7 days,
// and the runs with no answer. An unmeasured service keeps its last real sample and an older t; it is never written as
// a failure. A run that does not finish in time is written with complete=false and the missing services as "-".
//
// This program knows nothing about visitors and writes only its own folder. Its measured cost (one round, 210 services)
// is in README.md; the systemd units next to this file are the deployment used by 1ms.dog.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const version = "0.1.0"

type target struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type sample struct {
	OK      bool    `json:"ok"`
	Unknown bool    `json:"unknown"` // 403, 429, a challenge page: reachable, but not confirmable either way
	Ms      float64 `json:"ms"`
	HTTP    int     `json:"http,omitempty"`
	Err     string  `json:"err,omitempty"`
	T       int64   `json:"t"` // unix seconds this service was measured
}

type outage struct {
	From int64  `json:"from"`
	To   int64  `json:"to"`
	Runs int    `json:"runs"`
	Err  string `json:"err,omitempty"`
}

type svcOut struct {
	OK      bool     `json:"ok"`
	Unknown bool     `json:"unknown"`
	Ms      float64  `json:"ms"`
	HTTP    int      `json:"http,omitempty"`
	Err     string   `json:"err,omitempty"`
	T       int64    `json:"t"`
	OkAt    int64    `json:"ok_at,omitempty"`
	H       string   `json:"h"`
	Up24    *float64 `json:"up24"`
	Up7     *float64 `json:"up7"`
	Out     []outage `json:"out,omitempty"`
}

type latestFile struct {
	V        int                `json:"v"`
	Tool     string             `json:"tool"`
	Version  string             `json:"version"`
	From     string             `json:"from"`
	At       time.Time          `json:"at"`
	Every    int                `json:"every"`
	Complete bool               `json:"complete"`
	TookMs   int64              `json:"took_ms"`
	Count    int                `json:"count"`
	Bytes    int64              `json:"bytes"`
	Services map[string]*svcOut `json:"services"`
}

// one run of the day file: only the services that were measured, compactly
type dayRun struct {
	T int64              `json:"t"`
	S map[string]*sample `json:"s"`
}
type dayFile struct {
	V    int      `json:"v"`
	Tool string   `json:"tool"`
	Day  string   `json:"day"`
	Runs []dayRun `json:"runs"`
}

const (
	keepDays    = 30
	summaryDays = 7
	historyMax  = 7 * 24 * 6 // 10-minute samples over 7 days
)

func main() {
	out := flag.String("out", "", "folder to write latest.json and days/ to")
	from := flag.String("from", "Tokyo, JP", "where this runs, as shown on the page")
	services := flag.String("services", "", "services.json (default: next to this program)")
	conc := flag.Int("concurrency", 20, "requests in flight at once")
	timeout := flag.Duration("timeout", 5*time.Second, "per-service timeout")
	spread := flag.Duration("spread", 45*time.Second, "spread the round over this long, so nothing hits at one second")
	every := flag.Int("every", 600, "seconds between runs, written to the file")
	maxRun := flag.Duration("max", 8*time.Minute, "whole round limit; what did not finish is written as not measured")
	flag.Parse()

	if *out == "" {
		fmt.Fprintln(os.Stderr, "down-probe: --out DIR is required")
		os.Exit(2)
	}
	svcPath := *services
	if svcPath == "" {
		self, err := os.Executable()
		if err == nil {
			svcPath = filepath.Join(filepath.Dir(self), "services.json")
		}
	}
	if svcPath == "" {
		fmt.Fprintln(os.Stderr, "down-probe: --services is required")
		os.Exit(2)
	}
	raw, err := os.ReadFile(svcPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "down-probe: %v\n", err)
		os.Exit(1)
	}
	var targets []target
	if err := json.Unmarshal(raw, &targets); err != nil {
		fmt.Fprintf(os.Stderr, "down-probe: services.json: %v\n", err)
		os.Exit(1)
	}
	if len(targets) == 0 {
		fmt.Fprintln(os.Stderr, "down-probe: services.json is empty")
		os.Exit(1)
	}

	t0 := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), *maxRun)
	defer cancel()

	if *conc < 1 {
		*conc = 1
	}
	results, bytes := measureAll(ctx, targets, *conc, *timeout, *spread)
	complete := len(results) == len(targets)
	run := dayRun{T: t0.Unix(), S: results}
	if err := writeDay(*out, run); err != nil {
		fmt.Fprintf(os.Stderr, "down-probe: %v\n", err)
		os.Exit(1)
	}
	latest, err := summarize(*out, *from, *every, t0, time.Since(t0), complete, len(targets), results, bytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "down-probe: %v\n", err)
		os.Exit(1)
	}
	if err := writeJSON(*out, "latest.json", latest); err != nil {
		fmt.Fprintf(os.Stderr, "down-probe: %v\n", err)
		os.Exit(1)
	}
}

func measureAll(ctx context.Context, targets []target, conc int, timeout, spread time.Duration) (map[string]*sample, int64) {
	out := make(map[string]*sample, len(targets))
	var bytes int64
	var mu sync.Mutex
	sem := make(chan struct{}, conc)
	var wg sync.WaitGroup
	step := time.Duration(0)
	if len(targets) > 1 && spread > 0 {
		step = spread / time.Duration(len(targets)-1)
	}
	for i, t := range targets {
		wg.Add(1)
		go func(i int, t target) {
			defer wg.Done()
			if i > 0 && step > 0 {
				select {
				case <-time.After(time.Duration(i) * step):
				case <-ctx.Done():
					return
				}
			}
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			s, n := measure(ctx, t.URL, timeout)
			if s == nil {
				return
			}
			mu.Lock()
			out[t.ID] = s
			bytes += n
			mu.Unlock()
		}(i, t)
	}
	wg.Wait()
	return out, bytes
}

func measure(parent context.Context, rawURL string, timeout time.Duration) (*sample, int64) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	u, err := url.Parse(rawURL)
	if err != nil {
		return &sample{Err: "bad url", T: time.Now().Unix()}, 0
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return &sample{Err: "bad url", T: time.Now().Unix()}, 0
	}
	req.Header.Set("User-Agent", "1ms.dog down probe (+https://down.1ms.dog)")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Range", "bytes=0-0")
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           (&net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   timeout,
			ResponseHeaderTimeout: timeout,
			DisableCompression:    true,
		},
		CheckRedirect: func(r *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return &sample{Err: errKind(err), T: time.Now().Unix()}, 0
	}
	// Read a little of the body: enough to see a challenge page, and a normal end to the request.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	ms := float64(time.Since(start).Microseconds()) / 1000
	s := &sample{Ms: round1(ms), HTTP: resp.StatusCode, T: time.Now().Unix()}
	challenge := resp.Header.Get("cf-mitigated") == "challenge" ||
		strings.Contains(strings.ToLower(string(body)), "just a moment") ||
		strings.Contains(strings.ToLower(string(body)), "attention required")
	switch {
	case challenge || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		// the service answered; it is telling us (or our IP) no. That is not a service outage.
		s.Unknown = true
		s.Err = "challenge"
	case resp.StatusCode >= 500:
		s.Err = fmt.Sprintf("http %d", resp.StatusCode)
	default:
		s.OK = true
	}
	return s, int64(len(body))
}

func errKind(err error) string {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "timeout") || strings.Contains(s, "deadline exceeded"):
		return "timeout"
	case strings.Contains(s, "connection reset") || strings.Contains(s, "broken pipe"):
		return "reset"
	case strings.Contains(s, "no such host") || strings.Contains(s, "server misbehaving"):
		return "dns"
	case strings.Contains(s, "tls") || strings.Contains(s, "certificate") || strings.Contains(s, "handshake"):
		return "tls"
	case strings.Contains(s, "connection refused"):
		return "refused"
	case strings.Contains(s, "no route to host") || strings.Contains(s, "network is unreachable"):
		return "unreachable"
	default:
		return "error"
	}
}

func writeDay(dir string, run dayRun) error {
	day := time.Unix(run.T, 0).UTC().Format("2006-01-02")
	path := filepath.Join(dir, "days", day+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	df := dayFile{V: 1, Tool: "down-probe", Day: day}
	if b, err := os.ReadFile(path); err == nil {
		json.Unmarshal(b, &df)
	}
	df.Runs = append(df.Runs, run)
	if err := writeJSON(dir, filepath.Join("days", day+".json"), df); err != nil {
		return err
	}
	return pruneDays(filepath.Join(dir, "days"), time.Unix(run.T, 0))
}

// summarize rebuilds latest.json from the last 7 days of runs, so a wrong history repairs itself on the next run.
func summarize(dir, from string, every int, at time.Time, took time.Duration, complete bool, count int, cur map[string]*sample, bytes int64) (*latestFile, error) {
	cut := at.AddDate(0, 0, -summaryDays)
	var runs []dayRun
	for d := 0; d <= summaryDays; d++ {
		day := at.AddDate(0, 0, -d).Format("2006-01-02")
		var f dayFile
		if b, err := os.ReadFile(filepath.Join(dir, "days", day+".json")); err == nil && json.Unmarshal(b, &f) == nil {
			runs = append(runs, f.Runs...)
		}
	}
	sort.Slice(runs, func(i, j int) bool { return runs[i].T < runs[j].T })
	out := &latestFile{V: 1, Tool: "down-probe", Version: version, From: from, At: at, Every: every, Complete: complete, TookMs: took.Milliseconds(), Count: count, Bytes: bytes, Services: map[string]*svcOut{}}
	ids := make([]string, 0, len(cur))
	for id := range cur {
		ids = append(ids, id)
	}
	// services that were not measured this round still get their last real sample
	for _, r := range runs {
		for id := range r.S {
			if _, ok := cur[id]; !ok {
				if _, seen := out.Services[id]; !seen {
					ids = append(ids, id)
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		if s := buildService(id, runs, cut, at); s != nil {
			out.Services[id] = s
		}
	}
	return out, nil
}

func buildService(id string, runs []dayRun, cut, at time.Time) *svcOut {
	var hist []byte
	var last *sample
	var lastT, lastOK int64
	n24, ok24, n7, ok7 := 0, 0, 0, 0
	var outs []outage
	var cur *outage
	for _, r := range runs {
		s := r.S[id]
		if s == nil {
			// a run that did not measure this service breaks an outage: unknown is not down
			if cur != nil {
				outs = append(outs, *cur)
				cur = nil
			}
			if r.T >= cut.Unix() {
				hist = append(hist, '-')
			}
			continue
		}
		t := time.Unix(s.T, 0)
		if t.Before(cut) {
			continue
		}
		v := byte('x')
		switch {
		case s.OK:
			v = 'o'
		case s.Unknown:
			v = 'u'
		}
		hist = append(hist, v)
		if s.OK || s.Unknown || s.Err != "" {
			last, lastT = s, s.T
		}
		if s.OK {
			lastOK = s.T
		}
		if s.OK || (!s.Unknown && s.Err != "") {
			n7++
			if s.OK {
				ok7++
			}
			if t.After(at.Add(-24 * time.Hour)) {
				n24++
				if s.OK {
					ok24++
				}
			}
		}
		switch {
		case s.Err != "" && !s.Unknown && cur == nil:
			cur = &outage{From: s.T, To: s.T, Runs: 1, Err: s.Err}
		case s.Err != "" && !s.Unknown:
			cur.To, cur.Runs = s.T, cur.Runs+1
		case cur != nil:
			outs = append(outs, *cur)
			cur = nil
		}
	}
	if cur != nil {
		outs = append(outs, *cur)
	}
	for i, j := 0, len(outs)-1; i < j; i, j = i+1, j-1 {
		outs[i], outs[j] = outs[j], outs[i]
	}
	if len(outs) > 20 {
		outs = outs[:20]
	}
	if len(hist) > historyMax {
		hist = hist[len(hist)-historyMax:]
	}
	if last == nil {
		return nil
	}
	o := &svcOut{OK: last.OK, Unknown: last.Unknown, Ms: last.Ms, HTTP: last.HTTP, Err: last.Err, T: lastT, OkAt: lastOK, H: string(hist), Out: outs}
	if n24 > 0 {
		o.Up24 = ptr(round1(float64(ok24) * 100 / float64(n24)))
	}
	if n7 > 0 {
		o.Up7 = ptr(round1(float64(ok7) * 100 / float64(n7)))
	}
	return o
}

func pruneDays(dir string, now time.Time) error {
	cut := now.AddDate(0, 0, -keepDays).Format("2006-01-02")
	es, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, e := range es {
		n := e.Name()
		if strings.HasSuffix(n, ".json") && len(n) == len("2006-01-02.json") && n[:10] < cut {
			os.Remove(filepath.Join(dir, n))
		}
	}
	return nil
}

// writeJSON writes a whole file: a temporary file in the same folder, then a rename over the real one.
func writeJSON(dir, name string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }
func ptr(v float64) *float64   { return &v }
