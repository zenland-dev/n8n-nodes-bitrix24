import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Resource } from '../../shared/spec';
import { buildProperties, executeResources } from '../../shared/spec';
import { WEBHOOK_CREDENTIAL } from '../../shared/transport';
import { engineResource } from './resources/engine';

const resources: Resource[] = [engineResource];

export class Bitrix24Ai implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 AI',
		name: 'bitrix24Ai',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Register your own AI services in Bitrix24 and list the ones already connected',
		defaults: { name: 'Bitrix24 AI' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'The AI services a Bitrix24 portal sends prompts to. This node connects a service and lists what is connected; it does not run a prompt — Bitrix24 calls the endpoint itself when a person uses AI in a CRM card, a chat or a rule. Register takes a code, a category (text, image, audio or call) and the address of an endpoint you host: Bitrix24 checks that address answers 200 before it saves anything, sends prompts to it later with a callbackUrl, and expects the answer posted back there. Get Many says what is registered and under which application. The webhook needs the ai_admin permission and an administrator behind it.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'engine'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
