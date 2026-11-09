// GET /api/meetings/{id} with the link's hash in the X-Meeting-Link header.
const { app } = require("@azure/functions");
const { getMeeting } = require("../meeting");

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
