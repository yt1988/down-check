package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func run(t int64, samples map[string]*sample) dayRun { return dayRun{T: t, S: samples} }
func ok(t int64) *sample                             { return &sample{OK: true, Ms: 12, HTTP: 200, T: t} }
func bad(t int64) *sample                            { return &sample{Err: "timeout", T: t} }
func unknown(t int64) *sample                        { return &sample{Unknown: true, Err: "challenge", HTTP: 403, T: t} }

func TestBuildServiceHistoryAndOutages(t *testing.T) {
	runs := []dayRun{
		run(1000, map[string]*sample{"x": ok(1000)}),
		run(1600, map[string]*sample{"x": ok(1600)}),
		run(2200, map[string]*sample{"x": bad(2200)}),
		run(2800, map[string]*sample{"x": bad(2800)}),
		run(3400, map[string]*sample{"x": ok(3400)}),
		run(4000, map[string]*sample{}), // this run did not measure it: not a failure
		run(4600, map[string]*sample{"x": bad(4600)}),
	}
	at := time.Unix(5000, 0)
	s := buildService("x", runs, at.AddDate(0, 0, -7), at)
	if s == nil {
		t.Fatal("no service")
	}
	if s.H != "ooxxo-x" {
		t.Fatalf("history %q", s.H)
	}
	if s.OK || s.Unknown {
		t.Fatal("the last sample is a failure")
	}
	if s.Up24 == nil || *s.Up24 != 50 {
		t.Fatalf("up24 %v", s.Up24)
	}
	if len(s.Out) != 2 || s.Out[0].From != 4600 || s.Out[0].Runs != 1 || s.Out[1].From != 2200 || s.Out[1].Runs != 2 {
		t.Fatalf("outages %+v", s.Out)
	}
	if s.T != 4600 {
		t.Fatalf("sample time %d", s.T)
	}
}

func TestUnknownIsNeitherUpNorDown(t *testing.T) {
	runs := []dayRun{
		run(1000, map[string]*sample{"x": ok(1000)}),
		run(1600, map[string]*sample{"x": unknown(1600)}),
		run(2200, map[string]*sample{"x": bad(2200)}),
	}
	at := time.Unix(3000, 0)
	s := buildService("x", runs, at.AddDate(0, 0, -7), at)
	if s.H != "oux" {
		t.Fatalf("history %q", s.H)
	}
	if s.Up7 == nil || *s.Up7 != 50 {
		t.Fatalf("up7 %v", s.Up7)
	}
	if len(s.Out) != 1 || s.Out[0].From != 2200 {
		t.Fatalf("an unknown run must break an outage: %+v", s.Out)
	}
}

func TestUnmeasuredServiceKeepsLastSample(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	old := now.Add(-20 * time.Minute)
	if err := writeDay(dir, run(old.Unix(), map[string]*sample{"x": ok(old.Unix())})); err != nil {
		t.Fatal(err)
	}
	// this round measured something else, not x
	cur := map[string]*sample{"y": ok(now.Unix())}
	if err := writeDay(dir, run(now.Unix(), cur)); err != nil {
		t.Fatal(err)
	}
	l, err := summarize(dir, "Tokyo, JP", 600, now, time.Second, true, 1, cur, 0)
	if err != nil {
		t.Fatal(err)
	}
	x := l.Services["x"]
	if x == nil || !x.OK || x.T != old.Unix() || x.H != "o-" {
		t.Fatalf("unmeasured service: %+v", x)
	}
}

func TestOutcomeClassification(t *testing.T) {
	cases := []struct {
		status int
		body   string
		hdr    string
		ok, un bool
	}{
		{200, "hello", "", true, false},
		{204, "", "", true, false},
		{301, "", "", true, false},
		{404, "nope", "", true, false},
		{403, "", "", false, true},
		{429, "", "", false, true},
		{200, "<html>Just a moment...</html>", "", false, true},
		{200, "<html>ok</html>", "challenge", false, true},
		{500, "", "", false, true},
		{503, "", "", false, true},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c.hdr != "" {
				w.Header().Set("cf-mitigated", c.hdr)
			}
			w.WriteHeader(c.status)
			w.Write([]byte(c.body))
		}))
		s, _ := measure(context.Background(), srv.URL, 2*time.Second)
		srv.Close()
		if s == nil || s.OK != c.ok || s.Unknown != c.un {
			t.Fatalf("status %d body %q hdr %q: %+v", c.status, c.body, c.hdr, s)
		}
	}
}

func TestErrKind(t *testing.T) {
	for in, want := range map[string]string{
		"context deadline exceeded":          "timeout",
		"read tcp: connection reset by peer": "reset",
		"dial tcp: lookup x: no such host":   "dns",
		"tls: handshake failure":             "tls",
	} {
		if got := errKind(errString(in)); got != want {
			t.Fatalf("%q → %q, want %q", in, got, want)
		}
	}
}

type errString string

func (e errString) Error() string { return string(e) }
