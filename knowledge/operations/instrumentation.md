# Instrumentation, Control Loops and the Generated P&ID

Modules: `src/simulation/treatment/instrumentation.ts`, `src/ui/studio/PidSheet.tsx`. Effects are in `plantDynamics.ts`, `game/incidents.ts`, `game/operations.ts` and `ui/screens/Scada.tsx`.

## What can be installed (per unit, in the Studio inspector)
| Item | ISA-5.1 tags | Units | CAPEX (GAME MODEL 🟡) |
|---|---|---|---|
| pH control loop: analyser, controller, metering-pump VFD | AIT-xx, AIC-xx, SC → DP-xxA | neutralisation, precipitation, coagulation (only with a pH trim) | RM 18,000 |
| DO control loop: analyser, controller, blower VFD | AIT-xx, AIC-xx → B-xxA | activated sludge | RM 22,000 |
| Level transmitter + high-level switch | LIT-xx, LSH-xx | EQ | RM 6,000 |
| Inlet flow meter | FIT-00 | raw wastewater | RM 12,000 |
| Duty/standby machine with auto-changeover | DP-xxB / B-xxB | dosing units / aeration | RM 9,000 (pump), RM 35,000 (blower) |

Missing data means the standard set: control loops, level and flow instruments are installed, so older designs and saves keep full control. **Standby machines are not installed by default** (QA review: otherwise every pump or blower trip on a standard plant would change over automatically and trips would vanish from the game). Cr(VI) reduction's pH/ORP control is part of the unit and is not optional. Coagulation has a pH loop only when it has a pH-trim set-point.

The SCADA warm-up and its cache key include the instrumentation, so a manual plant starts from a manual operating state.

Routine dynamic grab samples for manual plants use a replay of at most 20 h, and are skipped during a breakdown week (the steady sample with the breakdown applies), to keep weekly simulation light. The coagulation unit's old fixed RM 25,000 "pH control" CAPEX is replaced by the pH-loop instrument cost.

## What changes without them (physics stays in the existing models)
- **No pH loop:**
  - the reagent pump runs at a fixed manual setting equal to the design-average dose (half the pump capacity) instead of the PI loop, so pH follows the daily load swing;
  - a coagulation pH trim cannot run, so `pHset` is ignored (`effectiveParams`);
  - SCADA shows no pH or pump trend and raises no pH alarm.
- **No DO loop:** the blower runs at its design output, kLa = kLa_max / 1.6. NH₃ suffers at the afternoon peak and energy is wasted at night. SCADA shows no DO trend or alarm.
- **No level instruments:** no EQ level trend or overflow alarm.
- **No flow meter:** no inlet flow trend. A hydraulic surge is first reported by operators, not by an alarm.
- **Weekly grab sample:** a plant with any manual loop takes its routine sample from the dynamic replay at a random hour (6–30 h), not the steady design point. This uses the design-stream warm cache, so it costs about one replay per week.
- **Commissioning** is still judged at the design point (steady model), so instruments are an operations decision, not a commissioning one. 🟡 Possible extension: commission on the dynamic replay.

## Incidents
- **Pump or blower trip with a standby installed:** the standby takes over automatically. The incident is replaced by a repair of RM 500 and a message.
- **Without a standby,** the fix is emergency hire or replacement: a pump costs RM 3,500 and a blower RM 9,000, instead of switching to standby.
- **Probe drift** can only happen where a probe exists.
- **First symptoms** reflect what is instrumented. For example, a pump trip on an unmonitored tank shows up as "Weekly lab sample: final effluent pH out of range".

## The P&ID sheet
The P&ID is generated from the PFD layout and is read-only. It shows:
- equipment, tagged;
- process lines numbered WW-nnn, sludge lines SL-nnn and recycle lines RC-nnn;
- duty/standby transfer and sludge pumps;
- metering pumps per reagent;
- blowers;
- instrument bubbles: a plain circle for a field instrument, a circle in a square for a PLC/DCS function;
- dashed signal lines.

Units running without their loop are labelled "MANUAL DOSE" or "FIXED-SPEED BLOWER". Clicking a symbol or bubble selects the unit in the inspector, where the instruments are switched on or off.
