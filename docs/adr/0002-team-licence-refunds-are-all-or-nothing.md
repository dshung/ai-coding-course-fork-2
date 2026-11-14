# ADR 0002: Team licence Refunds are all-or-nothing

A Refund always covers a whole Purchase, so a Team licence can be refunded only while none of its seats has been claimed. Once one seat is claimed, nothing can be refunded, not even the unclaimed seats. We chose this to keep a Refund as a single concept, money back for one Purchase with no partial amounts, rather than adding per-seat refunds. If unused seats ever need to be refundable, that will be a new concept (a "Seat Refund"), not a change to what a Refund is.
