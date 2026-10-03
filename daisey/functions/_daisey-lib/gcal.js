// Maps the app's Google Calendar tool calls onto real Calendar API v3.
// Field names differ between the MCP shape (startTime/endTime) and
// Google's real Event resource (start.dateTime/end.dateTime) — that
// rename is the only real translation needed, this is otherwise a
// near-passthrough.
async function gFetch(path, { method = "GET", accessToken, params = {}, body } = {}) {
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 204 No Content on delete */ }
  if (!res.ok) {
    const err = new Error((json && json.error && json.error.message) || `Google ${method} ${path} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function toGoogleEventBody(input) {
  const body = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.colorId !== undefined) body.colorId = input.colorId;
  if (input.startTime !== undefined) body.start = { dateTime: input.startTime };
  if (input.endTime !== undefined) body.end = { dateTime: input.endTime };
  return body;
}

async function call(tool, input, accessToken) {
  if (tool === "list_events") {
    const res = await gFetch(`/calendars/${encodeURIComponent(input.calendarId)}/events`, {
      accessToken,
      params: {
        timeMin: input.startTime,
        timeMax: input.endTime,
        maxResults: input.pageSize || 100,
        // Without this, a recurring event comes back as one RRULE master
        // that the app's start/end parsing can't read at all.
        singleEvents: "true",
        orderBy: "startTime",
      },
    });
    return {
      accessRole: res.accessRole,
      events: res.items || [],
      summary: res.summary,
      timeZone: res.timeZone,
    };
  }

  if (tool === "list_calendars") {
    const res = await gFetch("/users/me/calendarList", { accessToken });
    return { calendars: (res.items || []).map(c => ({ id: c.id, summary: c.summary, timeZone: c.timeZone })) };
  }

  if (tool === "create_event") {
    return gFetch(`/calendars/${encodeURIComponent(input.calendarId)}/events`, {
      method: "POST", accessToken, body: toGoogleEventBody(input),
    });
  }

  if (tool === "update_event") {
    // PATCH natively does partial updates — the app's updateBrickDesc
    // sending only `description` was previously unverified against the
    // real MCP connector; here it's just correct by construction.
    return gFetch(`/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`, {
      method: "PATCH", accessToken, body: toGoogleEventBody(input),
    });
  }

  if (tool === "delete_event") {
    await gFetch(`/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`, {
      method: "DELETE", accessToken,
    });
    return { status: "cancelled" };
  }

  const err = new Error(`Unknown Google Calendar tool: ${tool}`);
  err.status = 400;
  throw err;
}

module.exports = { call };
