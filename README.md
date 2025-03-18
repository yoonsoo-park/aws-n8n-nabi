# N8n Nabi Infrastructure

AWS CDK infrastructure for deploying n8n workflow automation platform with a custom MCP server.

## Architecture

This project deploys the following components:

- **n8n server**: Main application server for workflow automation
- **n8n worker**: Worker for executing workflows
- **MCP server**: Custom integration server
- **PostgreSQL**: Database for storing workflow data
- **Redis**: Cache and queue management
- **Application Load Balancer**: For routing traffic to the services

## Prerequisites

- Node.js 20+
- AWS CLI configured with appropriate credentials
- AWS CDK installed

## Setup

1. Install dependencies:

```bash
npm install
```

2. Build the project:

```bash
npm run build
```

3. Deploy to your AWS account:

```bash
npm run aws:deploy
```

## Infrastructure Overview

### Networking

- Uses existing VPC from account parameters
- Containers run in private subnets
- Load balancer is internet-facing

### Containers

- All containers run on AWS Fargate (serverless)
- n8n uses the official n8n image
- MCP server uses a custom build
- Container-to-container communication secured via security groups

### Database

- Uses Aurora PostgreSQL Serverless v2
- Credentials stored in AWS Secrets Manager

### Cache

- Uses Amazon ElastiCache for Redis
- Supports n8n's queue-based execution model

## Security

- All secrets stored in AWS Secrets Manager
- Communication between components secured with security groups
- HTTPS for external access

## Maintenance

- Deployed resources have consistent naming with prefixes
- Stack outputs exported for reference
- Health checks configured for all services
