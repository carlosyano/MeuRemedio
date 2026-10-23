// Comandos de incidente de seguranca (RF-012, TS-030, DC-067): incident:open, incident:contain,
// incident:resolve, incident:decide, incident:close e incident:report. Resumo e decisao sao texto
// livre sem dado de titular; a evidencia fica no cofre e so a referencia entra.
import { parseArgs } from 'node:util';
import {
  advanceIncident,
  decideIncident,
  INCIDENT_SEVERITIES,
  incidentReport,
  openIncident,
  type IncidentSeverity,
  type IncidentTransition,
} from '../modules/audit/application/incidents.js';
import { freeText, oneOf, uuid, type OpsCommand } from './args.js';

export const INCIDENT_USAGE = [
  '  incident:open --severity <severidade> --summary <texto> [--evidence-ref <ref>]',
  '  incident:contain|incident:resolve|incident:close --id <uuid> [--evidence-ref <ref>]',
  '  incident:decide --id <uuid> --decision <texto>',
  '  incident:report --id <uuid>',
  `  severidades: ${INCIDENT_SEVERITIES.join(', ')}`,
];

const evidence = (value: string | undefined): { evidenceRef?: string } =>
  value === undefined ? {} : { evidenceRef: freeText('evidence-ref', value, 512) };

const open: OpsCommand = async (args, io) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      severity: { type: 'string' },
      summary: { type: 'string' },
      'evidence-ref': { type: 'string' },
    },
  });
  const severity = oneOf<IncidentSeverity>('severity', values.severity, INCIDENT_SEVERITIES);
  const summary = freeText('summary', values.summary, 500);
  io.out(
    JSON.stringify(
      await openIncident(io, { severity, summary, ...evidence(values['evidence-ref']) }),
    ),
  );
};

const transition =
  (name: IncidentTransition): OpsCommand =>
  async (args, io) => {
    const { values } = parseArgs({
      args,
      strict: true,
      options: { id: { type: 'string' }, 'evidence-ref': { type: 'string' } },
    });
    const id = uuid('id', values.id);
    io.out(
      JSON.stringify(
        await advanceIncident(io, { id, transition: name, ...evidence(values['evidence-ref']) }),
      ),
    );
  };

const decide: OpsCommand = async (args, io) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { id: { type: 'string' }, decision: { type: 'string' } },
  });
  const id = uuid('id', values.id);
  const decision = freeText('decision', values.decision, 1000);
  io.out(JSON.stringify(await decideIncident(io, { id, decision })));
};

const report: OpsCommand = async (args, io) => {
  const { values } = parseArgs({ args, strict: true, options: { id: { type: 'string' } } });
  io.out(JSON.stringify(await incidentReport(io, uuid('id', values.id))));
};

export const INCIDENT_COMMANDS: Readonly<Record<string, OpsCommand>> = {
  'incident:open': open,
  'incident:contain': transition('contain'),
  'incident:resolve': transition('resolve'),
  'incident:decide': decide,
  'incident:close': transition('close'),
  'incident:report': report,
};
