export function SnackArt({ kind }: { kind: "tea" | "bread" | "combo" }) {
  return (
    <svg viewBox="0 0 280 180" aria-hidden="true" focusable="false">
      <ellipse cx="140" cy="154" rx="94" ry="10" fill="#141712" opacity=".16" />
      {kind !== "tea" && (
        <g
          transform={
            kind === "combo" ? "translate(-27 13) scale(.95)" : "translate(0 0)"
          }
        >
          <path
            d="M51 115 Q48 79 86 66 Q112 45 139 65 Q180 48 217 85 Q234 103 214 130 Q128 159 64 135Z"
            fill="#d99a44"
            stroke="#6d4829"
            strokeWidth="3"
          />
          <path
            d="M61 108 Q65 84 89 78 Q119 59 139 78 Q178 61 210 93 L214 112 Q132 137 61 120Z"
            fill="#f9d17f"
          />
          <path
            d="M93 82 L85 113 M136 77 L128 120 M176 80 L169 116"
            stroke="#c38b3b"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M103 92 L114 87 L124 95 L111 99Z M155 95 L170 91 L180 100 L166 105Z"
            fill="#fff0bb"
          />
        </g>
      )}
      {kind !== "bread" && (
        <g
          transform={
            kind === "combo" ? "translate(72 -2) scale(.83)" : "translate(0 0)"
          }
        >
          <path
            d="M160 15 L141 91"
            stroke="#384e3c"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M92 50 L107 148 Q141 160 175 148 L190 50Z"
            fill="#edb849"
            stroke="#5f6238"
            strokeWidth="3"
          />
          <path d="M97 72 L109 144 Q141 155 173 144 L185 72Z" fill="#b96625" />
          <path
            d="M111 73 L134 76 L130 98 L108 94Z M145 78 L167 72 L176 91 L152 99Z M125 108 L144 105 L150 126 L127 132Z"
            fill="#f4d58d"
            opacity=".7"
          />
          <ellipse
            cx="141"
            cy="50"
            rx="49"
            ry="8"
            fill="#fff0b8"
            stroke="#5f6238"
            strokeWidth="3"
          />
          <circle
            cx="183"
            cy="74"
            r="20"
            fill="#b3cf70"
            stroke="#456146"
            strokeWidth="3"
          />
          <circle cx="183" cy="74" r="14" fill="#deecaf" />
          <path
            d="M183 61 L183 87 M170 74 L196 74 M174 64 L192 84 M174 84 L192 64"
            stroke="#b3cf70"
            strokeWidth="2"
          />
        </g>
      )}
      <path
        d="M37 45 L41 35 L45 45 L55 49 L45 53 L41 63 L37 53 L27 49Z"
        fill="#677d44"
      />
      <circle cx="238" cy="61" r="4" fill="#677d44" />
    </svg>
  );
}
