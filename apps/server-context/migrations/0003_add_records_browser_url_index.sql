-- The Chrome linked-thought lookup filters the browser URL and then reads newest
-- records first. Keep URL-less records out of this index; the existing ordering
-- index continues to serve unfiltered history requests.
CREATE INDEX IF NOT EXISTS records_browser_url_recorded_at_id_idx
  ON records (
    json_extract(data, '$.context.browser.url'),
    recorded_at DESC,
    id DESC
  )
  WHERE json_extract(data, '$.context.browser.url') IS NOT NULL;
