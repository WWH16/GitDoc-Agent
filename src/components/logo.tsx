// Paths come from brand/build.py (small-cut symbol and the custom wordmark); regenerate there, don't hand-edit.
// The D and "gitdoc" follow the text colour so they flip with the theme; the commit dot is the brand accent.
export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="46 40 154 176" aria-hidden="true" className="h-7 w-auto">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M66 40H122A88 88 0 0 1 122 216H66A20 20 0 0 1 46 196V60A20 20 0 0 1 66 40ZM108.64 99.06A21 21 0 1 0 83 101.89L83 154.11A21 21 0 1 0 105 154.11L105 128A55 55 0 0 0 138 139H154V117H138A33 33 0 0 1 108.64 99.06Z"
        />
        <circle cx="154" cy="128" r="24" className="fill-brand" />
      </svg>
      {/* Hidden on phones so the header fits 375px. The viewBox is symmetric around the x-height centre (y = -50), so flex centring matches the lockup */}
      <svg viewBox="0 -161 1086 222" aria-hidden="true" className="hidden h-6 w-auto sm:block">
        <path
          fill="currentColor"
          d="M102 -50A51 51 0 1 1 0 -50A51 51 0 1 1 102 -50ZM80 -50A29 29 0 1 0 22 -50A29 29 0 1 0 80 -50ZM80 -100H102V10H80ZM102 10A51 51 0 0 1 11.93 42.78L28.78 28.64A29 29 0 0 0 80 10ZM116 -100H138V0H116ZM140.64 -126A13.64 13.64 0 1 1 113.36 -126A13.64 13.64 0 1 1 140.64 -126ZM164 -124H186V0H164ZM152 -100H208V-80.2H152ZM324 -50A51 51 0 1 1 222 -50A51 51 0 1 1 324 -50ZM302 -50A29 29 0 1 0 244 -50A29 29 0 1 0 302 -50ZM302 -136H324V0H302ZM440 -50A51 51 0 1 1 338 -50A51 51 0 1 1 440 -50ZM418 -50A29 29 0 1 0 360 -50A29 29 0 1 0 418 -50ZM542.9 -15.87A51 51 0 1 1 542.9 -84.13L526.55 -69.4A29 29 0 1 0 526.55 -30.6Z"
        />
        <path
          className="fill-muted-foreground"
          d="M696 -50A51 51 0 1 1 594 -50A51 51 0 1 1 696 -50ZM684 -50A39 39 0 1 0 606 -50A39 39 0 1 0 684 -50ZM684 -100H696V0H684ZM812 -50A51 51 0 1 1 710 -50A51 51 0 1 1 812 -50ZM800 -50A39 39 0 1 0 722 -50A39 39 0 1 0 800 -50ZM800 -100H812V10H800ZM812 10A51 51 0 0 1 721.93 42.78L731.12 35.07A39 39 0 0 0 800 10ZM920.25 -22.97A51 51 0 1 1 928 -50L916 -50A39 39 0 1 0 910.07 -29.33ZM832 -55H928V-44.2H832ZM942 -100H954V0H942ZM942 -58A42 42 0 0 1 1026 -58L1014 -58A30 30 0 0 0 954 -58ZM1014 -58H1026V0H1014ZM1052 -124H1064V0H1052ZM1040 -100H1086V-89.2H1040Z"
        />
      </svg>
      <span className="sr-only">GitDoc Agent</span>
    </span>
  )
}
