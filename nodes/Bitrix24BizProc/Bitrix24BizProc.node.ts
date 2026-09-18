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
import { eventResource } from './resources/event';
import { taskResource } from './resources/task';
import { templateResource } from './resources/template';
import { workflowResource } from './resources/workflow';

const resources: Resource[] = [workflowResource, taskResource, templateResource, eventResource];

export class Bitrix24BizProc implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Business Processes',
		name: 'bitrix24BizProc',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Start Bitrix24 business processes, answer their tasks and let a waiting process move on',
		defaults: { name: 'Bitrix24 Business Processes' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 business processes as the user who owns the webhook, which here has to be an administrator: bizproc methods answer ACCESS_DENIED to anyone else. Workflow → Start runs a template on one record, named by Document Type and Record ID — a deal, a lead, a list element, a Drive file — and answers the workflow ID, a string like 66e412fdc9bd44.36306599. Get Instances lists what is running now, Terminate stops a process and keeps its data, Delete removes it altogether. Task covers what a process asks of people: Get Many reads the waiting approvals and questions, Complete answers one for the webhook user, Delegate hands tasks over. Template → Get Many finds the template ID to start. Event answers an automation rule that is waiting for this workflow: it needs the event token the rule posted, and works only for rules registered by an application.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Reads and changes the deals, leads and companies a business process runs on',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Lists',
					relationHint: 'Reads and changes the list elements a business process runs on',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks, robots and actions included',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'workflow'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
