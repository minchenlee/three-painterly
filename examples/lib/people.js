// People, pets and boats for a park of the 1880s, on top of voxels.js. Each builder returns a model (createModel) that
// faces +x, stands on y = 0 and is centred on z = 0. One voxel is about 10 cm: an adult is 19 voxels tall.
// Not part of any package. It serves the examples and may change with them.
import { createModel as newModel } from './voxels.js';

/** Add the colours these builders use: peoplePalette(palette.def). */
export function peoplePalette(def) {
  def('SKIN SKIN2 HAIR HAIRLT BLACK COAT GREY GREYLT', 0xe8c4a2, 0xd9ae8a, 0x4a3426, 0x9a6a3c, 0x2b2738, 0x3a3658, 0x8a8a9a, 0xc2c2cc);
  def('NAVY VIOLET PLUMD ROSE RED ORANGE OCHRE CREAMW WHITEW', 0x36457c, 0x6c5c9a, 0x4b3d6c, 0xd993ab, 0xcc4a34, 0xe0823a, 0xcfa656, 0xefe6cf, 0xf6f3ea);
  def('BLUE SKYBLUE GREEND BROWN TAN BRASS WOODB SAIL SMOKE', 0x3f6fb8, 0x8fb4dc, 0x3f6a48, 0x6a4a33, 0xc59a66, 0xd8b23a, 0x7a5a3c, 0xf4f0e4, 0x9a9aa2);
}

export function createPeople(C, detail = 2) {
  const createModel = () => newModel(detail);
  const head = (m, x, y, skin = C.SKIN) => { m.ellipsoid(x, y, 0, 1.5, 1.7, 1.5, skin); };
  const arm = (m, pts, c, hand = C.SKIN) => { for (let i = 0; i + 1 < pts.length; i++) m.line(pts[i], pts[i + 1], c, 0.75); const h = pts[pts.length - 1]; m.set(h[0], h[1], h[2], hand); };
  /** A parasol held at hand [x, y, z]: a stick and a cover. */
  const parasol = (m, hand, c, r = 4.6, lean = 0.6) => {
    const top = [hand[0] + lean, hand[1] + 10, hand[2] - 1];
    m.line(hand, top, C.BROWN); m.dome(top[0], top[1] - 2, top[2], r, 2.2, (x, z) => (Math.hypot(x - top[0], z - top[2]) > r - 1 ? C.BLACK : c)); m.set(top[0], top[1] + 1, top[2], C.BROWN);
  };
  const hats = {
    top: (m, x, y, c = C.BLACK) => { m.ellipsoid(x, y, 0, 2.4, 0.5, 2.4, c); for (let i = 1; i <= 3; i++) m.ellipsoid(x, y + i, 0, 1.6, 0.5, 1.6, c); },
    boater: (m, x, y, c = C.OCHRE, band = C.BLACK) => { m.ellipsoid(x, y, 0, 2.5, 0.5, 2.5, c); m.ellipsoid(x, y + 1, 0, 1.6, 0.5, 1.6, band); m.ellipsoid(x, y + 2, 0, 1.6, 0.5, 1.6, c); },
    bonnet: (m, x, y, c = C.RED, trim = C.BLACK) => { m.ellipsoid(x - 0.4, y, 0, 2.0, 1.0, 1.9, c); m.ellipsoid(x - 0.2, y + 1, 0, 1.3, 0.8, 1.2, c); m.set(x + 1, y + 1, 1, trim); },
    cap: (m, x, y, c = C.NAVY) => { m.ellipsoid(x, y, 0, 1.7, 0.9, 1.6, c); m.set(x + 2, y, 0, c); },
    kepi: (m, x, y, c = C.RED) => { for (let i = 0; i < 2; i++) m.ellipsoid(x, y + i, 0, 1.5, 0.5, 1.5, c); m.set(x + 2, y, 0, C.BLACK); },
  };
  const bell = (m, waist, c, wide = 2.4, hem = null) => { for (let y = 0; y < waist; y++) { const r = 1.5 + Math.pow(1 - y / waist, 0.75) * wide; m.ellipsoid(0.3, y, 0, r * 1.05, 0.5, r * 0.85, y === 0 && hem ? hem : c); } };

  /**
   * A woman standing in profile. dress, bodice: colours. bustle: the padded back of the 1880s skirt. hat: 'bonnet' | 'boater' | null,
   * hatC: its colour. parasol: a colour, or null. rod: true for a fishing rod held out over the water.
   */
  function lady({ dress = C.VIOLET, bodice = C.PLUMD, bustle = true, hat = 'bonnet', hatC = C.BLACK, parasol: par = null, rod = false, hair = C.HAIR } = {}) {
    const m = createModel(), waist = 9;
    bell(m, waist, dress, 2.4, bodice);
    if (bustle) { m.ellipsoid(-2.7, waist - 1.6, 0, 2.3, 2.3, 1.9, dress); m.ellipsoid(-3.3, waist - 4.5, 0, 1.8, 2.6, 1.7, dress); }
    m.ellipsoid(0, waist + 3, 0, 1.6, 3.4, 2.1, bodice); m.set(0, 16, 0, C.SKIN);
    head(m, 0.2, 17.6); m.ellipsoid(-1.1, 18.0, 0, 1.2, 1.3, 1.4, hair);
    if (hat) hats[hat](m, 0.1, 19.4, hatC);
    arm(m, [[0, 14.5, -2.4], [0.6, 11, -2.6], [1.6, 9.5, -2.4]], bodice);                           // the far arm hangs
    if (par) { arm(m, [[0.4, 14.5, 2.4], [1.6, 11.5, 2.6], [3, 12.5, 2.4]], bodice); parasol(m, [3, 12.5, 2.4], par); }
    else if (rod) { arm(m, [[0.4, 14.5, 2.4], [2, 12, 2.6], [3.4, 12.2, 2.2]], bodice); m.line([3.4, 12.2, 2.2], [17, 17, 1], C.BROWN); m.line([17, 17, 1], [17.5, 4, 1], C.GREYLT); }
    else arm(m, [[0.4, 14.5, 2.4], [1.2, 11, 2.6], [2.2, 10, 2.2]], bodice);
    return m;
  }
  /** A man standing in profile. coat, trousers: colours. hat: 'top' | 'boater' | 'kepi' | 'cap'. cane, horn: true to hold one. */
  function gent({ coat = C.COAT, trousers = C.GREY, hat = 'top', hatC = C.BLACK, cane = false, horn = false, tails = true } = {}) {
    const m = createModel();
    for (const z of [-1, 1]) { m.box(-1, 0, 0, 8, z, z, trousers); m.box(-1, 1, 0, 0, z, z, C.BLACK); }
    m.ellipsoid(0, 11.6, 0, 1.6, 3.8, 2.2, coat); if (tails) m.box(-2, -1, 6, 9, -1, 1, coat);
    m.set(0, 16, 0, C.SKIN); m.set(1, 14, 0, C.WHITEW);
    head(m, 0.2, 17.6); m.ellipsoid(-1.0, 17.8, 0, 1.0, 1.2, 1.4, C.HAIR);
    hats[hat](m, 0.1, 19.4, hatC);
    arm(m, [[0, 14.5, -2.5], [0.3, 11, -2.7], [0.8, 8.5, -2.5]], coat);
    if (horn) { arm(m, [[0.4, 14.5, 2.5], [2.5, 13.5, 2.2], [3.2, 16.2, 1]], coat); m.line([2.2, 17, 0.6], [5.5, 16.6, 0.6], C.BRASS); m.ellipsoid(6.4, 16.6, 0.6, 1.0, 1.4, 1.4, C.BRASS); }
    else { arm(m, [[0.4, 14.5, 2.5], [1.2, 11, 2.7], [2.4, 8.6, 2.5]], coat); if (cane) m.line([2.4, 8.6, 2.5], [3.6, 0, 2.5], C.BLACK); }
    return m;
  }
  /** A woman sitting on the grass, her skirt spread in front of her. */
  function seatedLady({ dress = C.NAVY, bodice = C.NAVY, hat = 'bonnet', hatC = C.RED, parasol: par = null, sewing = false } = {}) {
    const m = createModel();
    m.ellipsoid(1.8, 0.9, 0, 4.4, 1.7, 2.9, dress); m.ellipsoid(0, 4.8, 0, 1.5, 3.0, 1.9, bodice); m.set(0, 8, 0, C.SKIN);
    head(m, 0.2, 9.6); m.ellipsoid(-1.1, 10.0, 0, 1.2, 1.3, 1.4, C.HAIR); if (hat) hats[hat](m, 0.1, 11.4, hatC);
    arm(m, [[0.3, 6.8, -2.2], [1.6, 4.4, -2.0], [3, 3.4, -1]], bodice);
    if (par) { arm(m, [[0.3, 6.8, 2.2], [1.5, 5.4, 2.4], [2.4, 6.2, 2.2]], bodice); parasol(m, [2.4, 6.2, 2.2], par, 4.2, -0.6); }
    else { arm(m, [[0.3, 6.8, 2.2], [1.6, 4.4, 2.0], [3, 3.4, 1]], bodice); if (sewing) m.box(3, 4, 3, 3, -1, 1, C.WHITEW); }
    return m;
  }
  /** A man sitting on the grass with his legs out. */
  function seatedGent({ coat = C.GREY, trousers = C.GREYLT, hat = 'top', hatC = C.BLACK, cane = true } = {}) {
    const m = createModel();
    for (const z of [-1, 1]) { m.box(0, 6, 0, 1, z, z, trousers); m.box(7, 7, 0, 2, z, z, C.BLACK); }
    m.ellipsoid(-0.2, 4.6, 0, 1.6, 3.2, 2.1, coat); m.set(0, 8, 0, C.SKIN); head(m, 0.2, 9.6); hats[hat](m, 0.1, 11.4, hatC);
    arm(m, [[0.2, 6.8, -2.3], [1.4, 4.2, -2.4], [2.6, 3, -2]], coat); arm(m, [[0.2, 6.8, 2.3], [1.6, 4.6, 2.4], [3, 4.2, 2.2]], coat);
    if (cane) m.line([3, 4.2, 2.2], [6, 0, 2.6], C.BLACK);
    return m;
  }
  /** A man lying on the grass, propped on one elbow, with a pipe. He faces +x; his legs trail behind. */
  function reclining({ shirt = C.ORANGE, trousers = C.SKYBLUE, hat = 'cap', hatC = C.NAVY } = {}) {
    const m = createModel();
    for (const z of [-1, 0.6]) m.line([-9, 0.8, z], [-1, 1.2, z], trousers, 1.0);
    m.box(-11, -10, 0, 1, -1, 1, C.BLACK);
    for (let i = 0; i <= 5; i++) m.ellipsoid(-0.5 + i * 0.9, 1.6 + i * 0.75, 0, 1.6, 1.6, 2.0, shirt);
    m.set(4.6, 6.2, 0, C.SKIN); head(m, 5.4, 7.4); hats[hat](m, 5.2, 9.0, hatC);
    arm(m, [[3.6, 4.6, 2.2], [4.6, 2, 2.6], [6.4, 0.6, 2.4]], C.SKIN); arm(m, [[3.6, 4.6, -2.2], [5, 2.6, -2.4], [6.4, 1.8, -1.6]], C.SKIN);
    m.line([7, 7, 0], [8.6, 6.4, 0], C.BROWN);
    return m;
  }
  /** A child. running: legs apart and arms out. */
  function child({ dress = C.WHITEW, hat = 'boater', hatC = C.CREAMW, running = false, hair = C.HAIRLT } = {}) {
    const m = createModel();
    if (running) { m.line([-2, 0, -1], [0, 4, -1], C.BLACK, 0.6); m.line([2.4, 1, 1], [0, 4, 1], C.BLACK, 0.6); for (let y = 3; y < 6; y++) m.ellipsoid(0, y, 0, 2.6 - (y - 3) * 0.5, 0.5, 2.2 - (y - 3) * 0.4, dress); }
    else for (let y = 0; y < 6; y++) m.ellipsoid(0, y, 0, 1.2 + Math.pow(1 - y / 6, 0.8) * 1.6, 0.5, 1.1 + Math.pow(1 - y / 6, 0.8) * 1.3, dress);
    m.ellipsoid(0, 7.4, 0, 1.2, 2.0, 1.5, dress); m.ellipsoid(0.2, 10.4, 0, 1.3, 1.4, 1.3, C.SKIN); m.ellipsoid(-0.9, 10.2, 0, 1.0, 1.6, 1.3, hair);
    if (hat) hats[hat](m, 0.1, 11.8, hatC);
    if (running) { arm(m, [[0, 8.6, 1.6], [2.6, 9.4, 2.0]], dress); arm(m, [[0, 8.6, -1.6], [-2.4, 7.4, -2.0]], dress); }
    else { arm(m, [[0, 8.6, 1.6], [0.6, 6, 1.8]], dress); arm(m, [[0, 8.6, -1.6], [0.6, 6, -1.8]], dress); }
    return m;
  }
  /** A dog. size: 1 for a big one. sniff: its nose is at the ground. */
  function dog({ c = C.BLACK, size = 1, sniff = false, tailUp = true } = {}) {
    const m = createModel(), k = size;
    m.ellipsoid(0, 3.4 * k, 0, 3.4 * k, 1.5 * k, 1.3 * k, c);
    for (const [x, z] of [[-2.4, -1], [-2.4, 1], [2.2, -1], [2.2, 1]]) m.line([x * k, 0, z * k], [x * k, 2.6 * k, z * k], c, 0.5 + 0.2 * (k > 0.8));
    const hx = sniff ? 4.6 * k : 4.2 * k, hy = sniff ? 1.4 * k : 4.6 * k;
    m.line([2.8 * k, 3.6 * k, 0], [hx - 0.8 * k, hy, 0], c, 0.9 * k); m.ellipsoid(hx, hy, 0, 1.4 * k, 1.1 * k, 1.1 * k, c); m.set(hx - 0.4 * k, hy + 1.3 * k, 1 * k, c); m.set(hx - 0.4 * k, hy + 1.3 * k, -1 * k, c);
    m.line([-3.2 * k, 3.8 * k, 0], tailUp ? [-4.4 * k, 6.4 * k, 0] : [-5.4 * k, 3 * k, 0], c);
    return m;
  }
  /** A small monkey on all fours, its tail curled up. */
  function monkey({ c = C.BROWN } = {}) {
    const m = createModel();
    m.ellipsoid(0, 2.4, 0, 1.9, 1.2, 1.0, c); for (const [x, z] of [[-1.2, -1], [-1.2, 1], [1.4, -1], [1.4, 1]]) m.line([x, 0, z], [x, 2, z], c);
    m.ellipsoid(2.6, 3.4, 0, 1.1, 1.1, 1.0, c); m.set(3.4, 3.2, 0, C.TAN);
    m.line([-1.8, 2.6, 0], [-3.6, 3.4, 0], c); m.line([-3.6, 3.4, 0], [-3.8, 5.6, 0], c); m.line([-3.8, 5.6, 0], [-2.8, 6.4, 0], c);
    return m;
  }
  /** A small sailing boat: a hull, a mast, one white sail. It sails towards +x. */
  function sailboat({ hull = C.WHITEW, sail = C.SAIL } = {}) {
    const m = createModel();
    for (let x = -14; x <= 14; x++) { const w = Math.round(3.2 * Math.sqrt(1 - (x / 15) ** 2)); for (let z = -w; z <= w; z++) { m.set(x, 0, z, C.BROWN); m.set(x, 1, z, Math.abs(z) === w || Math.abs(x) > 12 ? hull : 0); } m.set(x, 1, -w, hull); m.set(x, 1, w, hull); }
    m.line([1, 1, 0], [1, 36, 0], C.BROWN);
    for (let y = 4; y <= 34; y++) { const w = Math.round((34 - y) * 0.42); for (let x = 2; x <= 2 + w; x++) m.set(x, y, 0, sail); }
    for (let y = 5; y <= 22; y++) { const w = Math.round((22 - y) * 0.45); for (let x = -w; x <= 0; x++) m.set(x, y, 0, sail); }
    return m;
  }
  /** A steam launch with a funnel, smoke and a tricolour at the stern. */
  function steamer() {
    const m = createModel();
    for (let x = -22; x <= 22; x++) { const w = Math.round(4 * Math.sqrt(1 - (x / 23) ** 2)); for (let z = -w; z <= w; z++) for (let y = 0; y <= 2; y++) m.set(x, y, z, y === 2 ? C.WOODB : C.BLACK); }
    m.box(-8, 8, 3, 6, -2, 2, (x, y) => (y === 6 ? C.WHITEW : (x % 4 === 0 ? C.BLACK : C.WHITEW)));
    m.box(0, 1, 7, 13, 0, 1, C.BLACK); m.box(0, 1, 11, 11, 0, 1, C.RED);
    for (const [x, y, r] of [[-1, 16, 2], [-4, 19, 2.6], [-8, 21, 3.2], [-13, 22, 3.6]]) m.ellipsoid(x, y, 0.5, r, r * 0.8, r * 0.8, C.SMOKE);
    m.line([-21, 3, 0], [-21, 11, 0], C.BROWN); for (let y = 8; y <= 10; y++) for (let i = 0; i < 6; i++) m.set(-22 - i, y, 0, [C.BLUE, C.WHITEW, C.RED][i >> 1]);
    return m;
  }
  /** A racing shell with four rowers and a cox. */
  function scull() {
    const m = createModel();
    for (let x = -26; x <= 26; x++) for (let z = -1; z <= 1; z++) if (Math.abs(x) < 24 || z === 0) m.set(x, 0, z, C.WOODB);
    for (let i = 0; i < 4; i++) { const x = -14 + i * 8; m.ellipsoid(x, 2.6, 0, 1.2, 2.2, 1.5, C.WHITEW); m.ellipsoid(x + 0.3, 5.6, 0, 1.2, 1.2, 1.2, C.SKIN); m.line([x + 1, 3, 2], [x + 3, 0, 9], C.BROWN); m.line([x + 1, 3, -2], [x + 3, 0, -9], C.BROWN); }
    m.ellipsoid(20, 2.4, 0, 1.2, 2.0, 1.4, C.RED); m.ellipsoid(20, 5.2, 0, 1.2, 1.2, 1.2, C.SKIN);
    return m;
  }
  return { lady, gent, seatedLady, seatedGent, reclining, child, dog, monkey, sailboat, steamer, scull, parasol, hats };
}
