import type { Phase, Plan } from '../bag/library.js';
import { phaseLabels } from './format.js';

/** The plan drawn as a bar over days 0 to `span`: resting, rested and peak, the portion window, mid-peak and today. */
export function PlanBar(props: {
  plan: Plan | null;
  day: number | null;
  span?: number;
  large?: boolean;
  faded?: boolean;
}) {
  const span = Math.max(props.span ?? 60, props.plan?.peak.to ?? 0, props.day ?? 0);
  const width = props.large ? 1056 : 190;
  const x = (day: number) => (Math.min(Math.max(day, 0), span) / span) * width;
  const h = props.large ? 16 : 6;
  const top = props.large ? 20 : 8;
  const { plan } = props;
  return (
    <svg
      class={props.faded ? 'plan-bar faded' : 'plan-bar'}
      viewBox={`0 0 ${width} ${top + h + 12}`}
      width={width}
      height={top + h + 12}
      role="img"
      aria-label={plan === null ? 'No plan' : `Plan: peak from day ${plan.peak.from} to ${plan.peak.to}`}
    >
      <rect class="seg-resting" x={0} y={top} width={width} height={h} rx={h / 2} />
      {plan && (
        <>
          <rect
            class="seg-rested"
            x={x(plan.rest.from)}
            y={top}
            width={Math.max(x(plan.peak.from) - x(plan.rest.from), 0)}
            height={h}
          />
          <rect
            class="seg-peak"
            x={x(plan.peak.from)}
            y={top}
            width={Math.max(x(plan.peak.to) - x(plan.peak.from), 0)}
            height={h}
          />
          <rect
            class="seg-portion"
            x={x(plan.portion.from)}
            y={top - (props.large ? 8 : 5)}
            width={Math.max(x(plan.portion.to) - x(plan.portion.from), 3)}
            height={props.large ? 5 : 3}
          />
          <rect class="seg-mid" x={x(plan.mid_peak) - 1} y={top + h + 2} width={2} height={props.large ? 8 : 5} />
        </>
      )}
      {props.day !== null && (
        <rect
          class="seg-today"
          x={x(props.day) - 1}
          y={top - (props.large ? 14 : 8)}
          width={2}
          height={h + (props.large ? 22 : 14)}
        />
      )}
    </svg>
  );
}

export function PhasePill(props: { phase: Phase }) {
  return <span class={`pill phase-${props.phase}`}>{phaseLabels[props.phase]}</span>;
}

/** A rating of 0 to 5 in half steps, as five beans; "Not rated" without one. */
export function RatingBeans(props: { rating: number | null }) {
  if (props.rating === null) return <span class="muted small">Not rated</span>;
  const rating = props.rating;
  return (
    <span class="beans" role="img" aria-label={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const kind = rating >= n ? 'full' : rating >= n - 0.5 ? 'half' : 'empty';
        return (
          <svg width="12" height="16" viewBox="0 0 12 16" class={`bean ${kind}`} aria-hidden="true">
            <ellipse cx="6" cy="8" rx="5" ry="7" />
            {kind === 'half' && <path d="M6 1a5 7 0 0 0 0 14z" class="fill" />}
          </svg>
        );
      })}
    </span>
  );
}

export function Legend() {
  return (
    <div class="legend small muted">
      <span>
        <i class="key seg-resting" /> Resting
      </span>
      <span>
        <i class="key seg-rested" /> Rested
      </span>
      <span>
        <i class="key seg-peak" /> In peak
      </span>
      <span>
        <i class="key seg-portion" /> Portion and freeze
      </span>
      <span>
        <i class="key seg-mid thin" /> Mid-peak check
      </span>
      <span>
        <i class="key seg-today thin" /> Today
      </span>
    </div>
  );
}
