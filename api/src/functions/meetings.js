// The meeting details page's API. Both routes take the link's hash in the X-Meeting-Link header.
//   GET /api/meetings/{id}                                  the meeting, with saved statuses
//   PUT /api/meetings/{id}/action-items/{index}/status      body { status, task }
// Anyone with a meeting's link can change its statuses; there's no sign-in.
const { app } = require("@azure/functions");
const { getMeeting, setActionItemStatus } = require("../meeting");

const noStore = { "Cache-Control": "no-store" };

app.http("meetings", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "meetings/{id}",
  handler: async (request, context) => {
    try {
      const { status, body } = await getMeeting(request.params.id, request.headers.get("x-meeting-link"), process.env);
      return { status, jsonBody: body, headers: noStore };
    } catch (error) {
      context.error(error);
      return { status: 500, jsonBody: { error: "server_error" }, headers: noStore };
    }
  },
});

app.http("actionItemStatus", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "meetings/{id}/action-items/{index}/status",
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "invalid_body" }, headers: noStore };
    }
    try {
      const { status, body: result } = await setActionItemStatus(
        request.params.id, request.headers.get("x-meeting-link"), request.params.index, body, process.env);
      return { status, jsonBody: result, headers: noStore };
    } catch (error) {
      context.error(error);
      return { status: 500, jsonBody: { error: "server_error" }, headers: noStore };
    }
  },
});
