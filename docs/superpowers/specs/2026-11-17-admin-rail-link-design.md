# Admin link in Mi panel's rail — short design

**Why.** The owner wants to reach the admin home (`/admin-home.html`) in one tap from where they already are, without typing
the address. A way in already exists ("Administración" in Mi panel's left rail, admins only), but it is the 7th of 8
links under Herramientas, has a pencil icon left from when it opened the publishing desk, and looks exactly like the
member links. On a touch phone the rail is one sideways-scrolling row, so the link starts off screen to the right.

**Goal.** An admin opening Mi panel sees the way in at once, on laptop and phone, in EN/ES/PT.

**Non-goals.** No link in the page headers (profile, community, resources, knowledge, home): the owner chose the rail
only. No change for members: they never see the group. No change to the admin home or the staff bar.

**Approaches considered.**
- *Rail only, made obvious* — **picked by the owner.** Small; one page, its script, styles, dictionary and tests.
- Rail plus a header link on five member pages — reachable from anywhere, but touches five headers and a header that
  is already crowded at tablet widths.

**Design.**
- A first group at the top of the rail, above General: label **Equipo / Team / Equipe**, then one link.
- The link keeps `id="publishLink"`, `href="admin-home.html"` and the key `d.nav.publish`; its words become
  **Indicadores y gestión / Metrics and tools / Indicadores e gestão** (the page it opens is titled "Indicadores", and the
  staff bar there leads to the other tools).
- Icon: a trend line on two axes (the bar icon is already "Rutas comunitarias").
- Look: brand beige fill `#F2ECEC` with the dark brand green `#3D5C38` as text and icon, so it reads as different from
  member links (translucent white) and from the active link (bright green). Same pill shape, size and focus ring as the
  other rail links; 44px targets on touch screens as today.
- Both the label and the link start `hidden`; the existing check (`/api/auth/me` → `permission === 'admin'`) shows both,
  and nothing else. The server still guards the admin pages.
- Phone and tablet: the group's label hides like the others (≤980px), and the link is the first chip in the row, so it
  is on screen without scrolling.

**Left to the builder.** Hover and focus colours within the brand palette; the exact icon path; the `?v=` bumps the
deploy tests pin; updating the tests that pin the old markup and words (`tests/dashboard-publishing.test.js`).
