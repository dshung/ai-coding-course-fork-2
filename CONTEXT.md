# Cadence

An online course platform where instructors publish courses and students enroll in them.

## Language

### Ratings

**Rating**:
A single student's 1–5 whole-star judgement of a course. A student has at most one rating per course and can change it.
_Avoid_: Review (reserved for future written feedback)

**Rater**:
Any user enrolled in a course who is not that course's instructor. User role doesn't matter — an instructor enrolled in someone else's course can rate it.
_Avoid_: Registered (means "has an account")

**Rating Score**:
The confidence-adjusted figure shown to everyone for a course. It starts as if the course already had 5 neutral (3-star) ratings, so it only approaches the raw average once real ratings build up. Always shown next to the number of real ratings.
_Avoid_: Average, mean (the raw average is never displayed)

### Lesson discussion

**Comment**:
Anything a user posts on a lesson page, whether it starts a discussion or replies to one. Anyone who can view the lesson's content can post at any level: enrolled users of any role and Staff. A user blocked from the content (e.g. by regional pricing) can't comment either.

**Reply**:
A Comment posted in response to another Comment. Any Comment can be replied to, including a Reply, so discussions can nest to any depth.

**Thread**:
A top-level Comment together with every Reply beneath it, however deep.
_Avoid_: Conversation, discussion (too vague to tell apart)

**Staff**:
The people who speak for a course: its instructor and any admin. Another instructor enrolled in the course is not Staff for it.

**Unanswered Thread**:
A Thread with no live (non-deleted) Reply from Staff anywhere in it. Instructors work through these in their questions queue. A Staff Reply only means Staff took part, not that the answer is right.
_Avoid_: Unresolved (implies a resolution state the system doesn't track)

**Deleted Comment**:
A Comment removed by its author. If live Replies still sit beneath it, it remains as an anonymous "This comment was deleted." placeholder so the Thread still reads correctly. Otherwise it disappears entirely. Its Replies are never removed or moved along with it.

**Hidden Comment**:
A Comment that Staff have hidden. Only Staff can hide a Comment, and they can unhide it later. Others see "This comment was hidden by the instructor." The author still sees their own Comment, marked as hidden. Replies beneath it stay visible. The author can still edit it to fix the problem, but it stays hidden until Staff review it again and unhide it. Staff hide Comments but never delete other people's Comments.
_Avoid_: Removed, moderated (don't say whether the action can be undone)

**Flag**:
A user's report that a Comment needs Staff attention. A user can flag any Comment except their own, once each, without giving a reason. Flagging changes nothing for readers. It puts the Comment in front of Staff, who either hide it or dismiss the Flags. A new Flag after a dismissal brings it back to Staff.
_Avoid_: Report (fine in UI copy, but Flag is the term)

**Reaction**:
An emoji response to someone else's Comment, chosen from a fixed set (👍 ❤️ 🎉 🤔 👀). A user can add several different Reactions to a Comment but only one of each kind. Reactions appear as counts and never change the order Comments are shown in. You can't react to your own Comment, a Deleted Comment or a Hidden Comment.
_Avoid_: Like, vote, upvote (suggest ranking)

**Thread Participant**:
A user with at least one Comment in a Thread that they haven't deleted. Deleting all your Comments in a Thread means you're no longer a Participant. A Hidden Comment still counts, because hiding wasn't your choice. Reacting or flagging doesn't make you a Participant.

**Reply Notification**:
A message telling Thread Participants that a new Reply was posted in their Thread. Everyone who has posted in the Thread gets one, except the person who wrote the Reply. It shows up in the app only (no email), stays unread until opened, and links to the Reply. It disappears if the Reply is later deleted or hidden. It skips anyone who has muted the Thread. A Participant who can't currently view the course content (e.g. blocked by regional pricing) can't see their notifications for that course. They come back once access returns. Their Comments stay visible to everyone else throughout. A Reply that is hidden later sends no further notifications.

**Muted Thread**:
A Thread a Participant has turned Reply Notifications off for. Posting in the Thread again doesn't unmute it. Only the user can unmute it. Muting doesn't block a direct Reply to your own Comment. That still notifies you.

### Buying and refunds

**Purchase**:
One payment for a course, made by an individual student or by a team admin for a team licence.
_Avoid_: Order, transaction

**Team licence**:
A Purchase of several seats in a course. Each seat is a code that a team member claims.
_Avoid_: Bulk purchase, team purchase

**Refund**:
A request to get back exactly what was paid for a whole Purchase, which a platform Admin then Approves or Declines. A Purchase gets at most one Refund, and a Decline is final. Approving a Refund removes the student's access to the course.
_Avoid_: Reversal, Chargeback, Cancellation

**Refund eligibility**:
The conditions a Purchase must meet before a Refund can be requested: it's inside the 14-day window, the buyer has never had an approved Refund for this course, and the course hasn't been used too much (or, for a Team licence, no seat has been claimed).
_Avoid_: Cancellation offer, refund rules

**Chargeback**:
A dispute the cardholder raises with their bank, where the bank takes the money back without our agreement. This is not a Refund, and the platform doesn't model it yet.

### Earnings

**Gross revenue**:
What an instructor's courses took in over a period: Purchases made in that period, minus Refunds approved in that period.
_Avoid_: Sales, income

**Net earnings**:
Gross revenue after the platform's fee is taken off. This is what the instructor actually earns.
_Avoid_: Payout, profit
