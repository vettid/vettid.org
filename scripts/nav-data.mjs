// Single source of truth for site navigation (header dropdowns, mobile
// slide-out menu, footer link line). scripts/sync-nav.mjs renders this into
// every website/**/*.html page between <!-- nav:* --> markers; `npm run
// check:site` fails if any page drifts from it.
//
// Rules encoded here (see WEBSITE-EXPANSION-PLAN.md §5):
// - "Privacy Resources" parent label itself links to /playbooks/ — the
//   playbooks must never be more than one interaction away.
// - Parents without a natural landing page get `href: null` and render as
//   <button> (dropdown only, nothing to navigate to).
// - Entries are added here only once their page exists — check-site.mjs
//   fails on links to files that don't exist yet.

export const NAV = [
  {
    label: 'Privacy Resources',
    href: '/playbooks/',
    children: [
      { label: 'Playbooks', href: '/playbooks/' },
      // { label: 'Tools We Trust', href: '/tools-we-trust' },
    ],
  },
  {
    label: 'Technology',
    href: null,
    children: [
      { label: 'Use Cases', href: '/use-cases' },
      { label: 'Security', href: '/security' },
      { label: 'Open Source', href: '/open-source' },
    ],
  },
  // {
  //   label: 'AI',
  //   href: '/ai',
  //   children: [
  //     { label: 'LEASH', href: '/ai/leash' },
  //     { label: 'AAIF Membership', href: '/ai/aaif' },
  //     { label: 'How We Use AI', href: '/ai/how-we-use-ai' },
  //   ],
  // },
  {
    label: 'About',
    href: null,
    children: [
      { label: 'Why VettID', href: '/why' },
      { label: 'About', href: '/about' },
      // { label: 'Contact', href: '/contact' },
    ],
  },
  { label: 'Donate', href: '/donate' },
];

// Footer link line (order preserved). External links get target/rel handling
// in the renderer.
export const FOOTER_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Why VettID', href: '/why' },
  { label: 'Use Cases', href: '/use-cases' },
  { label: 'Playbooks', href: '/playbooks/' },
  { label: 'Security', href: '/security' },
  { label: 'Donate', href: '/donate' },
  { label: 'Open Source', href: '/open-source' },
  { label: 'GitHub', href: 'https://github.com/vettid', external: true },
];
