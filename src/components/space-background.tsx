/**
 * Fixed, pointer-events-none space backdrop: nebula glows + two starfield
 * layers + a faint masked grid. Sits at z-0 behind all content. Pure CSS, no
 * layout-triggering animation properties (only opacity/transform), so it stays
 * GPU-cheap.
 */
export function SpaceBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="nebula" />
      <div className="starfield" />
      <div className="starfield-2" />
      <div className="grid-veil" />
    </div>
  );
}
