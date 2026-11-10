// The meeting details page's API. All routes take the link's hash in the X-Meeting-Link header.
//   GET  /api/meetings/{id}                                   the meeting, with saved statuses
//                                                             and last follow-up times
//   PUT  /api/meetings/{id}/action-items/{index}/status       body { status, task }
//   POST /api/meetings/{id}/action-items/{index}/follow-up    body { task }: emails the owner
// Anyone with a meeting's link can change its statuses and send follow-ups; there's no sign-in.
const { app } = require("@azure/functions");
const { getMeeting, setActionItemStatus, sendFollowUp } = require("../meeting");

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

// Reads the JSON body and runs the action; a body that isn't JSON gets 400.
function itemAction(action) {
  return async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "invalid_body" }, headers: noStore };
    }
    try {
      const { status, body: result } = await action(
        request.params.id, request.headers.get("x-meeting-link"), request.params.index, body, process.env);
      return { status, jsonBody: result, headers: noStore };
    } catch (error) {
      context.error(error);
      return { status: 500, jsonBody: { error: "server_error" }, headers: noStore };
    }
  };
}

app.http("actionItemStatus", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "meetings/{id}/action-items/{index}/status",
  handler: itemAction(setActionItemStatus),
});

app.http("actionItemFollowUp", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "meetings/{id}/action-items/{index}/follow-up",
  handler: itemAction(sendFollowUp),
});
