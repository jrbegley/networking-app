// Unit checks for the job-posting extraction logic (no DB, no network).
// Run: npx tsx test-job-posting.mts

const {
  guardUrl,
  sourceFromHost,
  jobPostingFromJsonLd,
  htmlToText,
  THIN_CONTENT_CHARS,
} = await import("./src/lib/job-posting");

let fails = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`,
  );
}

// --- htmlToText ---------------------------------------------------------
check(
  "htmlToText: entity decode",
  htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39;&nbsp;end</p>"),
  "Tom & Jerry <3 \"hi\" 'x' end",
);
check(
  "htmlToText: no double-decode of &amp;lt;",
  htmlToText("<p>a &amp;lt; b</p>"),
  "a &lt; b",
);
check(
  "htmlToText: script removed",
  htmlToText("<div>keep<script>var x = 1 < 2;</script>text</div>"),
  "keep text",
);
check(
  "htmlToText: style removed",
  htmlToText("<div>keep<style>.a{color:red}</style>text</div>"),
  "keep text",
);
check(
  "htmlToText: block close -> newline",
  htmlToText("<p>one</p><p>two</p>"),
  "one\ntwo",
);
check(
  "htmlToText: br -> newline",
  htmlToText("line1<br>line2<br/>line3"),
  "line1\nline2\nline3",
);
check(
  "htmlToText: whitespace collapse",
  htmlToText("a    b\t\t c"),
  "a b c",
);
check(
  "htmlToText: caps at 15000 chars",
  htmlToText("<p>" + "a".repeat(20_000) + "</p>").length,
  15_000,
);

// --- guardUrl -----------------------------------------------------------
check("guardUrl: reject javascript:", guardUrl("javascript:alert(1)").ok, false);
check("guardUrl: reject file:", guardUrl("file:///etc/passwd").ok, false);
check("guardUrl: reject localhost", guardUrl("http://localhost/jobs").ok, false);
check("guardUrl: reject 10.0.0.1", guardUrl("http://10.0.0.1/jobs").ok, false);
check(
  "guardUrl: reject 169.254.169.254",
  guardUrl("http://169.254.169.254/latest/meta-data").ok,
  false,
);
check("guardUrl: reject 172.20.x", guardUrl("http://172.20.0.5/").ok, false);
check("guardUrl: reject .local", guardUrl("http://printer.local/").ok, false);
check("guardUrl: reject ::1", guardUrl("http://[::1]:8080/").ok, false);
check(
  "guardUrl: accept normal https ATS url",
  guardUrl("https://boards.greenhouse.io/acme/jobs/123").ok,
  true,
);
{
  const g = guardUrl("https://boards.greenhouse.io/acme/jobs/123");
  check("guardUrl: returns URL host", g.ok ? g.url.hostname : null, "boards.greenhouse.io");
}

// --- sourceFromHost -----------------------------------------------------
check("sourceFromHost: greenhouse", sourceFromHost("boards.greenhouse.io"), "Greenhouse");
check("sourceFromHost: lever", sourceFromHost("jobs.lever.co"), "Lever");
check("sourceFromHost: ashby", sourceFromHost("jobs.ashbyhq.com"), "Ashby");
check(
  "sourceFromHost: workday (myworkdayjobs)",
  sourceFromHost("acme.wd1.myworkdayjobs.com"),
  "Workday",
);
check("sourceFromHost: workday (generic)", sourceFromHost("workday.acme.com"), "Workday");
check("sourceFromHost: unknown -> Company site", sourceFromHost("careers.acme.com"), "Company site");

// --- jobPostingFromJsonLd ----------------------------------------------
const greenhouseHtml = `<html><head><script type="application/ld+json">${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Senior Engineer",
    hiringOrganization: { "@type": "Organization", name: "Acme Corp" },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: "San Francisco",
        addressRegion: "CA",
      },
    },
    validThrough: "2026-09-01T00:00:00",
  },
)}</script></head><body>...</body></html>`;
check("jsonld: greenhouse fixture", jobPostingFromJsonLd(greenhouseHtml), {
  company_name: "Acme Corp",
  role_title: "Senior Engineer",
  location: "San Francisco, CA",
  deadline: "2026-09-01",
});

const graphHtml = `<html><head><script type="application/ld+json">${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "Careers" },
      {
        "@type": "JobPosting",
        title: "Data Analyst",
        hiringOrganization: { name: "Globex" },
      },
    ],
  },
)}</script></head><body></body></html>`;
check("jsonld: @graph-wrapped fixture", jobPostingFromJsonLd(graphHtml), {
  company_name: "Globex",
  role_title: "Data Analyst",
  location: null,
  deadline: null,
});

// Malformed JSON must return null and MUST NOT throw.
let malformedThrew = false;
let malformedResult: unknown;
try {
  malformedResult = jobPostingFromJsonLd(
    '<script type="application/ld+json">{ "@type": "JobPosting", bad json ]</script>',
  );
} catch {
  malformedThrew = true;
}
check("jsonld: malformed JSON does not throw", malformedThrew, false);
check("jsonld: malformed JSON -> null", malformedResult, null);

check(
  "jsonld: no JSON-LD -> null",
  jobPostingFromJsonLd("<html><body><h1>Careers</h1></body></html>"),
  null,
);

// --- THIN_CONTENT_CHARS constant ---------------------------------------
check("THIN_CONTENT_CHARS", THIN_CONTENT_CHARS, 400);

process.exit(fails ? 1 : 0);
