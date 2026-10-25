// Job Hunt is Mor's alone (2026-10-25). It reads and moves folders in the
// signed-in account's own Drive with full Drive access, so nobody else is
// asked for Drive at consent (daisey-auth-google-start) or let through
// drive-handler (403 not_owner). The app's own check is jobs-sync.js JOBS_OWNER.
const JOBS_OWNER = "morsedero@gmail.com";

const isJobsOwnerEmail = (email) => String(email || "").trim().toLowerCase() === JOBS_OWNER;
// claims: a verified Firebase ID token's. Only a verified address counts.
const isJobsOwner = (claims) => claims?.email_verified === true && isJobsOwnerEmail(claims.email);

module.exports = { JOBS_OWNER, isJobsOwner, isJobsOwnerEmail };
