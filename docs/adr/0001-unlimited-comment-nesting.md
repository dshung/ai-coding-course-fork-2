# ADR 0001: Lesson comment Replies nest to any depth

- **Status:** Accepted
- **Date:** 2026-11-14
- **Scope:** Lesson discussion

## Context
Lesson comments started with replies limited to one level. A reply's parent had to be top-level, and the schema enforced this on write. That kept each Thread a flat Q&A conversation. It also let the instructor questions queue define "answered" simply, as a direct Staff reply to the question. But students want to answer each other, and instructors want to correct a student's guess where it was posted. Under the one-level rule, those conversations collapse into one flat list where it's unclear who is answering whom.

## Decision
Any Comment can be replied to, including a Reply, with no depth limit. A Thread is a top-level Comment plus every Reply beneath it. Rules that used to look only at direct replies now look at the whole Thread:
- A Thread is answered when a live Staff Reply exists anywhere in it.
- Deleting a Comment with live Replies beneath it leaves an anonymous placeholder at any depth.
- Reply Notifications go to every Thread Participant.

## Alternatives considered
- **Keep one level (reply to a reply attaches to the Thread, with an @mention):** simplest to render and query. Rejected because it loses the record of who replied to whom, which instructors need when correcting a specific guess.
- **Limit the depth (e.g. 3), then flatten:** limits layout problems, but has the same lost-context problem past the limit, and it's an arbitrary rule to explain.

## Consequences
- Deciding whether a Thread is answered needs a recursive query over descendants instead of a single join.
- Deleted Comments must be pruned bottom-up so placeholders appear only where live Replies depend on them.
- The UI stops indenting after a few levels and shows "Replying to X" so deep Threads stay readable beside the video.
- Going back to one level later would mean re-parenting existing deep Replies, which loses who replied to whom. Treat this decision as hard to reverse.
