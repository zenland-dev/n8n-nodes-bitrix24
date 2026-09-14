import type { IDataObject } from 'n8n-workflow';

import { stringList } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';

function asItem(result: unknown): IDataObject {
	return result !== null && typeof result === 'object' && !Array.isArray(result)
		? (result as IDataObject)
		: { result: result as IDataObject[keyof IDataObject] };
}

export const portalResource: Resource = {
	value: 'portal',
	name: 'Portal',
	description: 'What the webhook can reach: permissions, methods, the user it acts as',
	operations: [
		{
			value: 'getScopes',
			name: 'Get Permissions',
			action: 'Get the permissions of the webhook',
			description: 'List the permission scopes (crm, task, disk…) the webhook was given, or every scope the portal has',
			properties: [
				{
					displayName: 'All Portal Scopes',
					name: 'full',
					type: 'boolean',
					default: false,
					description: 'Whether to list every scope the portal offers instead of only those granted to the webhook',
				},
			],
			async execute(itemIndex) {
				const full = this.getNodeParameter('full', itemIndex) as boolean;
				const body = await bitrix24Request.call(this, 'scope', full ? { full: true } : {}, { itemIndex });
				return { scopes: (body.result ?? []) as string[] };
			},
		},
		{
			value: 'getMethods',
			name: 'Get Methods',
			action: 'Get the methods available to the webhook',
			description:
				'List classic REST method names the webhook may call. Newer controller methods such as crm.item.* are not listed by Bitrix24 here even when they work.',
			properties: [
				{
					displayName: 'Scope',
					name: 'scope',
					type: 'string',
					default: '',
					placeholder: 'crm',
					description: 'Only methods of this scope. Leave empty for all.',
				},
			],
			async execute(itemIndex) {
				const scope = String(this.getNodeParameter('scope', itemIndex, '')).trim();
				const body = await bitrix24Request.call(this, 'methods', scope !== '' ? { scope } : {}, { itemIndex });
				return { methods: (body.result ?? []) as string[] };
			},
		},
		{
			value: 'checkMethod',
			name: 'Check Method',
			action: 'Check whether a method exists and is allowed',
			description: 'Tell whether a method exists on the portal and whether the webhook may call it',
			properties: [
				{
					displayName: 'Method',
					name: 'method',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'crm.item.add',
				},
			],
			async execute(itemIndex) {
				// Bitrix24 compares in lower case and answers "does not exist" for a
				// camelCase name that works perfectly well when called.
				const name = String(this.getNodeParameter('method', itemIndex)).trim().toLowerCase();
				const body = await bitrix24Request.call(this, 'method.get', { name }, { itemIndex });
				return { method: name, ...asItem(body.result) };
			},
		},
		{
			value: 'getCurrentUser',
			name: 'Get Current User',
			action: 'Get the user the webhook acts as',
			description: 'Return the ID, name and administrator flag of the user whose rights the webhook uses',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'profile', {}, { itemIndex });
				return asItem(body.result);
			},
		},
		{
			value: 'getServerTime',
			name: 'Get Server Time',
			action: 'Get the portal server time',
			description: 'Return the current date and time of the portal with its time zone offset',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'server.time', {}, { itemIndex });
				return { time: body.result as string };
			},
		},
		{
			value: 'getAccessNames',
			name: 'Get Access Names',
			action: 'Get names for access codes',
			description: 'Turn access codes such as U1 (user), G2 (group), D5 (department) or AU (all users) into readable names',
			properties: [
				{
					displayName: 'Access Codes',
					name: 'codes',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'U1, G2, AU',
					description: 'Comma-separated access codes',
				},
			],
			async execute(itemIndex) {
				const access = stringList(this.getNodeParameter('codes', itemIndex));
				const body = await bitrix24Request.call(this, 'access.name', { ACCESS: access }, { itemIndex });
				return asItem(body.result);
			},
		},
	],
};
