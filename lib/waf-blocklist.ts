// Hostile source ranges blocked at the CloudFront edge (WAF IP set
// `vettid-org-blocklist`, rule `blocklist`, answered 403 before any other
// rule). Append a range here, with the date and the evidence, and deploy
// VettidOrgStack: the rule never changes. The rate rules stay the catch-all
// for ranges not identified yet.
export const EDGE_BLOCKLIST_V4: readonly string[] = [
  // 2026-11-04 (owner request): a scanner/flooder for weeks against vettid.org
  // and prote.us, rotating the last octet (.13, .29, .69, .205 seen), ~6,000
  // requests a day at nonexistent admin/debug/WordPress/PHP paths. Every
  // request ever seen from this /24 was the flooder.
  '185.177.72.0/24',
];
