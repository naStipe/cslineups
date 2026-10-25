// Feedback box: a button on the map opens a small form (suggestion or bug
// report). The message goes to /api/feedback and is read, solved or
// discarded by an admin in admin.html. Works signed out too; signed-out
// visitors can leave an email if they want a reply.
import { authHeaders, authUser } from "./auth.js";
import { feedbackBtn } from "./dom.js";
import { closeModal, watchDialog } from "./modal-utils.js";
import { sideSegment } from "./side.js";
import { state } from "./state.js";
import { toast, toastError } from "./toast.js";
import { setBusy } from "./ui-utils.js";

const modal = document.getElementById("feedbackModal");
const message = document.getElementById("feedbackMessage");
const count = document.getElementById("feedbackCount");
const contactWrap = document.getElementById("feedbackContactWrap");
const contact = document.getElementById("feedbackContact");
const website = document.getElementById("feedbackWebsite");
const send = document.getElementById("feedbackSend");
const KINDS = [{ id: "suggestion", label: "Suggestion" }, { id: "bug", label: "Bug report" }];
let kind = "suggestion";

function buildKind() {
  document.getElementById("feedbackKind").replaceChildren(sideSegment(KINDS, kind, (v) => { kind = v; }, { label: "Type of feedback" }));
}

function open() {
  kind = "suggestion";
  buildKind();
  message.value = "";
  website.value = "";
  count.textContent = "0 / 2000";
  contactWrap.hidden = !!authUser; // signed-in users are reachable through their account
  modal.classList.add("show");
}

async function submit() {
  const text = message.value.trim();
  if (!text) { message.focus(); toast("Write a message first"); return; }
  setBusy(send, true, "Sending…");
  try {
    const sel = state.selectedLineupId ? ` lineup:${state.selectedLineupId}` : "";
    const headers = { "Content-Type": "application/json" };
    if (authUser) Object.assign(headers, await authHeaders());
    const res = await fetch("/api/feedback", {
      method: "POST", headers,
      body: JSON.stringify({ kind, message: text, contact: contact.value.trim(), page: `map:${state.mapId}${sel}`, website: website.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't send your message.");
    closeModal(modal);
    toast("Thanks! Your feedback was sent.");
  } catch (e) { toastError(e.message); }
  setBusy(send, false);
}

watchDialog(modal, "show", () => message);
if (feedbackBtn) feedbackBtn.onclick = open;
document.getElementById("feedbackCancel").onclick = () => closeModal(modal);
send.onclick = submit;
message.addEventListener("input", () => { count.textContent = `${message.value.length} / 2000`; });
