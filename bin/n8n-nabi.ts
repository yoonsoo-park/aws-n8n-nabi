#!/usr/bin/env node

import "source-map-support/register";
import { Feature, Utility } from "@ncino/aws-cdk";
import { RemovalPolicy } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { SecurityGroups } from "../src/stacks/constructs/security-groups";
import { N8nStack } from "../src/stacks/n8n-stack";

const deployAccount =
  process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
const deployRegion =
  process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION;

// Create feature
console.log("🛠 Feature");
const feature = new Feature({
  name: "n8n-nabi",
  description: "N8n workflow automation with MCP server for nCino",
});

// Configuration
console.log("⚙️ Checking configuration...");
let removalPolicy: RemovalPolicy = RemovalPolicy.RETAIN;
if (feature.getContext("temporary", false)) {
  removalPolicy = RemovalPolicy.DESTROY;
}

//TODO: Get VPC from account parameters
const vpcId = StringParameter.valueFromLookup(
  feature.baseStack,
  "/acctdata/VpcId"
);
//TODO: Get VPC from account parameters
const vpc = Vpc.fromLookup(feature.baseStack, "n8n-vpc", {
  vpcId,
});

//TODO: Security Groups
const securityGroups = new SecurityGroups(feature.baseStack, vpc);

// Create N8n Stack
console.log("🛠 N8n Stack");
const n8nStack = new N8nStack(feature, `${feature.getFullName("Stack")}`, {
  description: `Required. Contains the n8n workflow automation platform with MCP server.`,
  env: {
    account: deployAccount,
    region: deployRegion,
  },
  securityGroups,
  removalPolicy,
  vpc,
});

// Synthesize
feature.synth();
