export interface LiquidMagneticOptions {

  maxPull?: number;

  stretch?: number;

  snapDistance?: number;
}

export function liquidMagnetic(node: HTMLElement, opts: LiquidMagneticOptions = {}) {
  const maxPull = opts.maxPull ?? 10;
  const stretch = opts.stretch ?? 0.14;
  const snapDistance = opts.snapDistance ?? 44;

  let engaged = false;

  const reset = () => {
    engaged = false;
    node.style.transition = 'transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    node.style.transform = 'translate3d(0px, 0px, 0) scale(1, 1)';
  };

  const onMove = (e: PointerEvent) => {
    const r = node.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);

    if (dist > snapDistance) {
      if (engaged) reset();
      return;
    }

    engaged = true;
    const ratio = Math.min(1, dist / Math.max(1, snapDistance));
    const angle = Math.atan2(dy, dx);
    const tx = Math.cos(angle) * maxPull * ratio;
    const ty = Math.sin(angle) * maxPull * ratio;
    const sx = 1 + stretch * ratio;
    const sy = 1 - stretch * 0.35 * ratio;
    const deg = (angle * 180) / Math.PI;

    node.style.transition = 'transform 85ms cubic-bezier(0.22, 1, 0.36, 1)';
    node.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotate(${deg.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${(-deg).toFixed(1)}deg)`;
  };

  const onLeave = () => {
    if (engaged) reset();
  };

  const onDown = () => {
    node.style.transition = 'transform 110ms cubic-bezier(0.22, 1, 0.36, 1)';
    node.style.transform = 'translate3d(0px, 0px, 0) scale(0.93, 0.93)';
  };

  const host = node.parentElement ?? node;
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointerup', reset);

  return {
    destroy() {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointerup', reset);
    }
  };
}
