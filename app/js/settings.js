/* Defaults, used until changed on the TV (changes are kept in localStorage).
   Note: on this TV updates are installed by uninstall + install, which clears
   localStorage, so these defaults are what a fresh install starts with. */
var SETTINGS = {
  // group-title values hidden from the group list, "All channels" and zapping
  hiddenGroups: ['Beachcam', 'Eixo do Mal', 'PCNELID', 'IEGCQT', '100 ou Mais', 'O Planeta Vivo', 'DRM test'],

  // colour theme used until one is picked on the TV (Info key): midnight, sunset, oled, forest,
  // fjord, espresso, lagoon, royal, noir-gold
  theme: 'midnight'
};
