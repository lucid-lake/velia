# Security

Please report a security problem privately to **contact@lucidlakelabs.com**, not in a public issue. Say what you found, how to reproduce it, and which page or file it affects. We will answer within a week.

The game runs in the browser and keeps no accounts. The one server part is `functions/api/e.js`, the anonymous play counter on the live site: it stores no IP address, sets no cookie and respects Do Not Track and Global Privacy Control (the rules are at the top of the file).
