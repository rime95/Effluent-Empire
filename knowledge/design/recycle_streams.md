# Recycle Streams, Splitters and Mixers

Module: `src/simulation/treatment/graph.ts`.

## Splitter and mixer
- **Mixer:** any node with more than one inlet blends its inlets flow-weighted and re-equilibrates the pH. The explicit `mixer` unit does only this, for drawing clarity.
- **Splitter:** outlet port `a` receives `split` % of the flow and port `b` the rest, at identical composition. A unit with several outlets on its main port still splits equally, as before.

## Recycles (tear streams)
Filtrate from a filter press, or thickener supernatant, is normally returned to the head of the works (EQ tank or a mixer). This creates a loop. It is solved by **successive substitution on tear streams** (Westerberg et al., *Process Flowsheeting*, 1979):
1. A depth-first search from the raw-wastewater inlet marks back-edges. These are the tear streams.
2. The tear streams start empty (Q = 0). The flowsheet, minus the tear edges, is solved in topological order.
3. Each tear stream is replaced by the value just computed for its source, and step 2 repeats.
4. **Wegstein acceleration** (added after QA review: a 92 % recycle failed under plain substitution):
   - each mass-flow component x of a tear stream is updated as x ← q·x + (1 − q)·f(x);
   - q = s/(s − 1), with s the secant slope, bounded to q ∈ [−20, 0];
   - q = 0 is plain substitution, used for the first passes.
5. **Convergence:** the residual |f(x) − x| / |f(x)| is below 10⁻⁵ for water, solids, COD, Ni/Cu/Zn, NH₄ and sulfate loads, within 80 passes. A non-converged result is flagged as an error and marked not OK.
6. Recycles of 50 %, 90 % and 95 % converge in tests.
   - Recycle loops in wastewater plants are contractive (the return is a small fraction of throughput), so plain substitution converges.
   - If it doesn't, the design is reported as non-converging.

The mass balance is checked on the converged solution. Recycled solids raise loads on the units in the loop; for example, filtrate solids return to the clarifier. That is real, and the game shows it.
