// Camera boom occlusion: at spawn the nexus sits behind the hero; the boom pulls in
// so the camera never sits inside the crystal, and stretches back out in the lane.
export default async function ({ block, SETUP }) {
  await block('camera: boom stays out of the nexus at spawn, full length in lane', `(async () => {
    ${SETUP}
    const cam = g.engine.camera, rig = g.camera;
    r.occludersRegistered = rig.occluders.length === 4;
    H.teleport(0, 37); rig.setYaw(0); rig.snapTo(H.pos); step(0.5);
    const nx = 0, nz = 42;
    const d = Math.hypot(cam.position.x - nx, cam.position.z - nz);
    r.boomClearsNexusAtSpawn = d >= 2.0 + 0.9 - 0.05 && rig.dist < 7;
    H.teleport(0, 5); rig.snapTo(H.pos); step(1.0);
    r.boomFullInLane = Math.abs(rig.dist - 7) < 0.05;
    return r;
  })()`);
}
