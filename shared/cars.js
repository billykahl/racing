// Car customisation shared by client and server: body styles and paint colours.
// Both are picked by index; the server validates indices and the snapshot
// carries them so every client builds the same car for every racer.

export const CAR_STYLES = [
  { id: 'racer', label: 'Racer' },   // the original low sports coupe
  { id: 'muscle', label: 'Muscle' }, // long bonnet, boxy, fat rear tyres
  { id: 'buggy', label: 'Buggy' },   // open-wheel kart/buggy, roll cage, tall knobbly tyres
  { id: 'van', label: 'Van' }        // tall boxy van, short bonnet
]

export const CAR_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#00acc1', '#ec407a', '#f5f5f5', '#546e7a', '#7cb342', '#ffb300', '#3949ab', '#d81b60']

export function clampStyle (i) {
  i = +i | 0
  return i >= 0 && i < CAR_STYLES.length ? i : 0
}

export function clampColor (i) {
  i = +i | 0
  return i >= 0 && i < CAR_COLORS.length ? i : 0
}
