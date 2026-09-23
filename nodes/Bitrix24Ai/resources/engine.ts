import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, jsonParameter } from '../../../shared/params';
import { rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { optionalInt } from '../../../shared/values';

/** The code of a service, as Bitrix24 spells it: letters, digits, dash and underscore. */
const CODE = /^[A-Za-z0-9_-]+$/;

export const engineResource: Resource = {
	value: 'engine',
	name: 'Service',
	description: 'AI services registered on the portal, the ones Bitrix24 sends prompts to',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many AI services',
			description: 'Read the AI services registered on the portal, all of them or the ones a filter names',
			properties: [
				{
					displayName: 'Limit',
					name: 'limit',
					type: 'number',
					typeOptions: { minValue: 1 },
					default: 50,
					description: 'Max number of results to return',
				},
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Filter by ID, APP_CODE, NAME, CODE, CATEGORY, COMPLETIONS_URL or DATE_CREATE, e.g. {"CATEGORY": "text"}. A field can carry a prefix: &gt;=, &gt;, &lt;=, &lt;, @ (in list), !@ (not in list), % (contains) or ! (not equal).',
				},
			],
			async execute(itemIndex) {
				const params: IDataObject = {};
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.filter = filter;
				const limit = optionalInt(this.getNodeParameter('limit', itemIndex, 50));
				if (limit !== undefined) params.limit = limit;

				// The method has no paging of its own: limit is all it takes.
				const body = await bitrix24Request.call(this, 'ai.engine.list', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'register',
			name: 'Register',
			action: 'Register an AI service',
			description:
				'Connect your own AI service to the portal. Bitrix24 checks the endpoint answers 200 before it saves the service.',
			properties: [
				{
					displayName: 'Name',
					name: 'serviceName',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'Acme GPT',
					description: 'Name people see when they pick the service in Bitrix24',
				},
				{
					displayName: 'Code',
					name: 'code',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'acme_gpt',
					description: 'Unique code of the service, of the characters A-Z, a-z, 0-9, dash and underscore',
				},
				{
					displayName: 'Category',
					name: 'category',
					type: 'options',
					default: 'text',
					description: 'What the service does, which decides where Bitrix24 offers it',
					options: [
						{ name: 'Audio', value: 'audio', description: 'Recognises speech in a file' },
						{ name: 'Call', value: 'call', description: 'Works on calls' },
						{ name: 'Image', value: 'image', description: 'Draws images; answers asynchronously' },
						{ name: 'Text', value: 'text', description: 'Answers a prompt with text' },
					],
				},
				{
					displayName: 'Endpoint URL',
					name: 'completionsUrl',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'https://api.example.com/bitrix24/ai/completions',
					description:
						'Address Bitrix24 sends prompts to. It has to answer within five seconds — 200 when the answer is ready, 202 when it is queued — and send the result to the callbackUrl that came with the request.',
				},
				{
					displayName: 'Settings',
					name: 'settings',
					type: 'collection',
					placeholder: 'Add Setting',
					default: {},
					options: [
						{
							displayName: 'Context Counted In',
							name: 'model_context_type',
							type: 'options',
							default: 'token',
							description: 'Unit the context limit is measured in',
							options: [
								{ name: 'Symbols', value: 'symbol' },
								{ name: 'Tokens', value: 'token' },
							],
						},
						{
							displayName: 'Context Limit',
							name: 'model_context_limit',
							type: 'number',
							default: 15666,
							description: 'How much context the model takes, counted the way Context Counted In says',
						},
						{
							displayName: 'Model Alias',
							name: 'code_alias',
							type: 'string',
							default: '',
							placeholder: 'ChatGPT',
							description: 'Name of the model shown next to the service',
						},
					],
				},
				{
					displayName: 'Extra Settings (JSON)',
					name: 'settingsJson',
					type: 'json',
					default: '{}',
					description: 'Settings merged over the ones above. Bitrix24 stores the object as it comes.',
				},
			],
			async execute(itemIndex) {
				const code = String(this.getNodeParameter('code', itemIndex, '')).trim();
				if (!CODE.test(code)) {
					throw new NodeOperationError(this.getNode(), 'Code may hold only letters, digits, dash and underscore', {
						itemIndex,
					});
				}
				const name = String(this.getNodeParameter('serviceName', itemIndex, '')).trim();
				const completionsUrl = String(this.getNodeParameter('completionsUrl', itemIndex, '')).trim();
				if (name === '' || completionsUrl === '') {
					throw new NodeOperationError(this.getNode(), 'Name and Endpoint URL are required', { itemIndex });
				}

				const collection = this.getNodeParameter('settings', itemIndex, {}) as IDataObject;
				const settings: IDataObject = {
					...jsonParameter<IDataObject>(this, 'settingsJson', itemIndex, {}),
					...compact({
						code_alias: collection.code_alias,
						model_context_type: collection.model_context_type,
						model_context_limit: optionalInt(collection.model_context_limit),
					}),
				};

				const params: IDataObject = {
					name,
					code,
					category: String(this.getNodeParameter('category', itemIndex, 'text')),
					completions_url: completionsUrl,
				};
				if (Object.keys(settings).length > 0) params.settings = settings;

				const body = await bitrix24Request.call(this, 'ai.engine.register', params, { itemIndex });
				return { id: body.result as number, code };
			},
		},
		{
			value: 'unregister',
			name: 'Unregister',
			action: 'Unregister an AI service',
			description:
				'Remove a registered AI service by its code. Bitrix24 answers false, not an error, when there is nothing to remove.',
			properties: [
				{
					displayName: 'Code',
					name: 'code',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'acme_gpt',
					description: 'Code of the service, as Service → Get Many returns it in code',
				},
			],
			async execute(itemIndex) {
				const code = String(this.getNodeParameter('code', itemIndex, '')).trim();
				if (code === '') {
					throw new NodeOperationError(this.getNode(), 'Code is required', { itemIndex });
				}

				const body = await bitrix24Request.call(this, 'ai.engine.unregister', { code }, { itemIndex });
				return { code, removed: body.result === true };
			},
		},
	],
};
