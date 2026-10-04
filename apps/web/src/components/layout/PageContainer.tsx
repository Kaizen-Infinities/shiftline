import { Outlet } from "react-router-dom";

/**
 * Layout route for pages that used to be rendered inside a `*Tabs` wrapper.
 *
 * Those wrappers had stopped rendering a tab bar long ago — all they still did
 * was map the current pathname to a page component and wrap it in
 * a nested fixed-width container. Now that the router points
 * straight at the page components, this reproduces that shell in one place.
 *
 * The nested container that used to sit here has been dropped:
 * its gutters stacked on top of `.inner-container`'s own padding and the
 * layout wrapper's, giving the table three nested gutters. Horizontal spacing
 * now comes solely from the max-w-[1024px] wrapper in BaseLayout.
 *
 * It adds no vertical margin either: the shell sets the top offset, so a title
 * starts at the same height on every screen (docs/specs/UI-v2.md, "Page layout").
 *
 * Only list/content pages sit under this route. Create/edit forms were never
 * inside a tab wrapper and stay full-width, exactly as before.
 */
const PageContainer = () => (
  <div className="w-full min-w-0">
    <Outlet />
  </div>
);

export default PageContainer;
