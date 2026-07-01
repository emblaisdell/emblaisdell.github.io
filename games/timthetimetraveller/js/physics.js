// Minimal AABB platformer physics in cell units.
// Boxes are {x,y,w,h} with the origin at top-left and +y pointing down.

export function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

// Move `box` by velocity (vx,vy) over dt against a list of solid rects,
// resolving X then Y. Mutates box.x/box.y. Returns collision flags.
export function moveAndCollide(box, vx, vy, dt, solids) {
  let hitLeft = false, hitRight = false, landed = false, head = false;

  box.x += vx * dt;
  if (vx !== 0) {
    for (const s of solids) {
      if (!overlap(box, s)) continue;
      if (vx > 0) { box.x = s.x - box.w; hitRight = true; }
      else { box.x = s.x + s.w; hitLeft = true; }
    }
  }

  box.y += vy * dt;
  if (vy !== 0) {
    for (const s of solids) {
      if (!overlap(box, s)) continue;
      if (vy > 0) { box.y = s.y - box.h; landed = true; }
      else { box.y = s.y + s.h; head = true; }
    }
  }

  return { hitLeft, hitRight, landed, head };
}
