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
import { loadOptions } from './methods';
import { backlogResource, epicResource, scrumStageResource, scrumTaskResource, sprintResource } from './resources/scrum';
import { customFieldResource, flowResource, stageResource, templateResource } from './resources/setup';
import { taskResource } from './resources/task';
import {
	checklistItemResource,
	dependencyResource,
	resultResource,
	templateChecklistItemResource,
	timeEntryResource,
} from './resources/taskParts';
import { workgroupMemberResource, workgroupResource } from './resources/workgroup';

const resources: Resource[] = [
	taskResource,
	checklistItemResource,
	timeEntryResource,
	resultResource,
	dependencyResource,
	stageResource,
	customFieldResource,
	templateResource,
	templateChecklistItemResource,
	flowResource,
	workgroupResource,
	workgroupMemberResource,
	sprintResource,
	epicResource,
	backlogResource,
	scrumStageResource,
	scrumTaskResource,
];

export class Bitrix24Tasks implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Tasks',
		name: 'bitrix24Tasks',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with tasks, checklists, time tracking, workgroups, flows and scrum in Bitrix24',
		defaults: { name: 'Bitrix24 Tasks' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 tasks and the workgroups they live in. A task needs a title and a responsible user ID (or a flow ID, and the flow assigns someone). Statuses are numbers: 2 pending, 3 in progress, 4 awaiting control, 5 completed, 6 deferred. Change status with the Start, Pause, Complete, Reopen operations rather than by writing STATUS. Field names on write are UPPER_CASE (TITLE, RESPONSIBLE_ID, DEADLINE, GROUP_ID, UF_CRM_TASK) and come back camelCase (title, responsibleId). Link a task to CRM with CRM Records like D_10 for deal 10, C_7 for contact 7. Comments live in the task chat: Task → Add Comment. A task that requires a result cannot be completed until Result → Create. Workgroup IDs come from the group picker or Workgroup → Get Many; a scrum is a project with a scrum master. Every write notifies the people on the task like a person doing it would. About 2 requests per second per portal.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Reads and changes the CRM records a task is linked to',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks, such as Drive uploads for task files',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'task'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
