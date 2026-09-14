import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { bitrix24Request, WEBHOOK_CREDENTIAL } from '../../shared/transport';
import { EVENT_OPTIONS } from './events';
import { expandFormBody, parseFormBody } from './formBody';

/** Reads the raw request body when n8n kept it, which is the most faithful source. */
function rawRequestBody(this: IWebhookFunctions): string | undefined {
	const request = this.getRequestObject() as unknown as { rawBody?: Buffer | string };
	const raw = request?.rawBody;
	if (raw === undefined || raw === null) return undefined;
	const text = typeof raw === 'string' ? raw : raw.toString('utf8');
	return text.trim() === '' ? undefined : text;
}

/** Compares two strings in time that does not depend on where they first differ. */
function sameToken(given: string, expected: string): boolean {
	if (expected === '') return false;
	const left = Buffer.from(given, 'utf8');
	const right = Buffer.from(expected, 'utf8');
	let difference = left.length ^ right.length;
	for (let index = 0; index < right.length; index++) {
		difference |= (left[index] ?? 0) ^ right[index];
	}
	return difference === 0;
}

const CRM_EVENT = /^ONCRM(LEAD|DEAL|CONTACT|COMPANY|QUOTE|DYNAMICITEM)(ADD|UPDATE)$/;
const ENTITY_TYPES: Record<string, number> = { LEAD: 1, DEAL: 2, CONTACT: 3, COMPANY: 4, QUOTE: 7 };

export class Bitrix24Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Trigger',
		name: 'bitrix24Trigger',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["events"] || []).length ? $parameter["events"].join(", ") : "Any event" }}',
		description: 'Starts a workflow when Bitrix24 sends an event through an outgoing webhook',
		defaults: { name: 'Bitrix24 Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: WEBHOOK_CREDENTIAL,
				required: true,
				displayOptions: { show: { fetchRecord: [true] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'In Bitrix24 open Developer resources → Other → Outgoing webhook, paste this node\'s Production URL as the handler address, tick the events, save, and copy the Application token it shows into the field below. Bitrix24 cannot subscribe an inbound webhook to events by itself, so this step is done once by hand.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Application Token',
				name: 'applicationToken',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				description:
					'The application token of the outgoing webhook. Requests that do not carry it are refused, so nobody who learns the URL can start the workflow.',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: [],
				options: EVENT_OPTIONS,
				description:
					'Which events start the workflow. Leave empty to accept every event the outgoing webhook sends; the list of events itself is chosen in Bitrix24.',
			},
			{
				displayName: 'Other Event Codes',
				name: 'otherEvents',
				type: 'string',
				default: '',
				placeholder: 'ONDISKFILEADD, ONLISTSELEMENTADD',
				description: 'Comma-separated event codes to accept that are not in the list above',
			},
			{
				displayName: 'Fetch the Changed CRM Record',
				name: 'fetchRecord',
				type: 'boolean',
				default: false,
				description:
					'Whether to read the full lead, deal, contact, company, quote or smart process item after an add or update event. Bitrix24 sends only its ID. Needs a credential.',
			},
		],
	};

	/**
	 * Nothing to register. event.bind, which would subscribe this URL, is refused to
	 * inbound webhooks (WRONG_AUTH_TYPE) — only an installed application may call it —
	 * so the outgoing webhook is created by hand in Bitrix24 and outlives activation.
	 */
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const rawBody = rawRequestBody.call(this);
		const payload = rawBody === undefined ? expandFormBody(this.getBodyData()) : parseFormBody(rawBody);
		const auth = (payload.auth ?? {}) as IDataObject;

		const expected = String(this.getNodeParameter('applicationToken', '') ?? '');
		if (!sameToken(String(auth.application_token ?? ''), expected)) {
			const response = this.getResponseObject();
			response.writeHead(403);
			response.end('forbidden');
			return { noWebhookResponse: true };
		}

		const event = String(payload.event ?? '').toUpperCase();
		const accepted = [
			...(this.getNodeParameter('events', []) as string[]),
			...String(this.getNodeParameter('otherEvents', '') ?? '')
				.split(',')
				.map((code) => code.trim().toUpperCase())
				.filter((code) => code !== ''),
		];
		// Events the workflow does not want are still acknowledged, so Bitrix24 does not
		// count them as failed deliveries.
		if (accepted.length > 0 && !accepted.includes(event)) return { webhookResponse: 'OK' };

		const data = (payload.data ?? {}) as IDataObject;
		const item: IDataObject = {
			event,
			eventHandlerId: payload.event_handler_id as string,
			timestamp: payload.ts as string,
			data,
			// The application token is a secret; everything else about the portal is kept.
			portal: { domain: auth.domain, memberId: auth.member_id, clientEndpoint: auth.client_endpoint },
		};

		const match = CRM_EVENT.exec(event);
		if (match !== null && (this.getNodeParameter('fetchRecord', false) as boolean)) {
			const fields = (data.FIELDS ?? {}) as IDataObject;
			const entityTypeId = ENTITY_TYPES[match[1]] ?? Number(fields.ENTITY_TYPE_ID);
			const id = Number(fields.ID);
			if (Number.isInteger(entityTypeId) && entityTypeId > 0 && Number.isInteger(id) && id > 0) {
				try {
					const body = await bitrix24Request.call(this, 'crm.item.get', { entityTypeId, id });
					item.record = ((body.result as IDataObject)?.item ?? body.result) as IDataObject;
				} catch (error) {
					// The event itself is real and should still start the workflow.
					item.recordError = error instanceof Error ? error.message : String(error);
				}
			}
		}

		return { workflowData: [[{ json: item }]] };
	}
}
