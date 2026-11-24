// fetch with one retry: a flaky connection ("Failed to fetch") or a 5xx gets a second try after 600 ms; a 4xx is final.
export async function fetchRetry(url, opts) {
  try {
    const r = await fetch(url, opts);
    if (r.status < 500) return r;
  } catch (e) { if (e?.name === 'AbortError') throw e; }
  await new Promise((res) => setTimeout(res, 600));
  return fetch(url, opts);
}
