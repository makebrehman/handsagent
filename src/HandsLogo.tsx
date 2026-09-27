import React, { useId } from 'react'

export const HandsLogo = ({ animated = false, className = "", style = {} }: { animated?: boolean, className?: string, style?: React.CSSProperties }) => {
  const gradientId = "sweep-" + useId().replace(/:/g, '')
  
  return (
    <div className={`hands-svg-logo ${className}`} style={{ width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...style }}>
      <svg 
        version="1.0" 
        xmlns="http://www.w3.org/2000/svg"
        viewBox="604 575 860 860"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', overflow: 'visible', transform: 'scaleX(-1)' }}
      >
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="600" y1="575" x2="1464" y2="1435">
            <stop offset="0%" stopColor="#0000FF" />
            <stop offset="40%" stopColor="#0000FF" />
            <stop offset="48%" stopColor="#80aaff" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="52%" stopColor="#80aaff" />
            <stop offset="60%" stopColor="#0000FF" />
            <stop offset="100%" stopColor="#0000FF" />
            
            {animated && (
              <animateTransform 
                attributeName="gradientTransform" 
                type="translate" 
                from="-800 -800" 
                to="800 800" 
                dur="1.5s" 
                repeatCount="indefinite" 
              />
            )}
          </linearGradient>
        </defs>
        <g 
          transform="translate(0.000000,2048.000000) scale(0.100000,-0.100000)"
          fill={animated ? `url(#${gradientId})` : "#0000FF"}
          stroke="none"
        >
          <path d="M9901 14375 c105 -148 207 -291 225 -316 l34 -46 -128 -94 c-543 -400 -1074 -901 -1464 -1379 -591 -727 -966 -1487 -1102 -2240 -90 -496 -57 -1046 87 -1465 57 -164 76 -212 141 -339 361 -711 1039 -1226 1836 -1395 211 -45 316 -55 555 -55 314 1 534 29 855 109 698 175 1432 569 1866 1000 113 112 158 186 152 250 -5 58 -39 78 -130 78 -145 0 -230 -26 -683 -208 -618 -248 -862 -319 -1197 -346 -350 -29 -565 37 -748 227 -261 272 -290 647 -82 1064 273 546 1038 1168 1925 1564 606 271 1309 453 1922 498 l40 3 2 -45 c2 -25 10 -175 18 -335 8 -159 17 -317 21 -351 l5 -61 -83 -7 c-592 -49 -1210 -227 -1779 -512 -473 -236 -832 -486 -1148 -797 -253 -250 -350 -388 -339 -482 5 -44 38 -57 128 -51 129 8 277 58 836 284 494 201 649 251 889 292 269 46 526 6 721 -111 114 -69 243 -209 304 -329 35 -70 77 -201 91 -285 74 -462 -276 -962 -1006 -1437 -469 -306 -1015 -543 -1550 -673 -695 -170 -1343 -170 -1965 0 -387 105 -655 226 -980 441 -732 484 -1233 1180 -1439 1999 -81 325 -106 535 -105 900 1 387 31 633 126 1015 92 374 213 693 405 1072 512 1011 1297 1910 2368 2710 93 71 173 127 177 125 4 -1 93 -123 199 -272z M12147 14263 c52 -109 128 -267 169 -351 l73 -152 -111 -56 c-688 -345 -1348 -830 -1913 -1405 -325 -331 -600 -675 -861 -1074 -41 -63 -79 -115 -85 -115 -6 0 -106 60 -222 133 -117 74 -265 166 -330 206 l-117 73 22 37 c51 85 201 300 333 476 312 416 669 813 1002 1115 560 508 1103 888 1728 1211 105 54 196 99 203 99 7 0 56 -89 109 -197z M13780 12880 c57 -201 105 -370 107 -377 3 -7 -43 -27 -129 -53 -606 -191 -1332 -543 -1903 -923 -462 -308 -843 -622 -1240 -1023 l-240 -242 -145 136 c-80 74 -208 194 -285 265 -77 71 -140 133 -140 137 0 15 238 261 416 430 526 500 1043 884 1704 1267 474 275 1025 525 1520 689 121 40 223 70 226 66 4 -4 53 -171 109 -372z" />
        </g>
      </svg>
    </div>
  )
}
