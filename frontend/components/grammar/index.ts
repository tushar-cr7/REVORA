/**
 * REVORA visual grammar — reusable primitives.
 *
 * Vocabulary and data mapping live in `@/lib/grammar`; the colour, silhouette and
 * type for every primitive live in `app/globals.css` (`rv-*`). Compose these
 * rather than hand-rolling a status chip, an amount or a timeline per page.
 *
 *   money         Amount · MonetaryDelta · FinancialMetric · FinancialStateTag · FinancialTick
 *   state         StateIndicator · LayerTag · OutcomeIndicator
 *   event         EventRow
 *   authority     LayerBlock · PolicyBoundary · DecisionState
 *   relationship  TimelineConnector · Timeline · RecoveryStage · RecoveryFlow
 *   time          Timestamp · TemporalToken · RetryCount · MetadataLine
 *
 * Related, already in the repo: `KindChip` / `KindNode` (components/ui/eventKinds.tsx)
 * label an event *kind*; the primitives here compose them.
 */
export * from './Money';
export * from './State';
export * from './Meta';
export * from './Flow';
export * from './Decision';
export * from './EventRow';
