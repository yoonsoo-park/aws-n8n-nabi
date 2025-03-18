import { Feature, Stack, StackConfig } from "@ncino/aws-cdk";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { SecurityGroups } from "./constructs/security-groups";
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  Protocol,
  Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
  ListenerCondition,
  ApplicationTargetGroup,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";

//⬇️⬇️⬇️ disable this for now, we might need to add it back in for mcp server ⬇️⬇️⬇️
//import { Repository } from "aws-cdk-lib/aws-ecr";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Repository as CodeRepository } from "aws-cdk-lib/aws-codecommit";
import {
  DatabaseCluster,
  DatabaseClusterEngine,
  AuroraPostgresEngineVersion,
  Credentials,
} from "aws-cdk-lib/aws-rds";
import { CfnCacheCluster, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Role, ServicePrincipal, ManagedPolicy } from "aws-cdk-lib/aws-iam";

export interface N8nStackProps extends StackConfig {
  securityGroups: SecurityGroups;
  removalPolicy: RemovalPolicy;
  vpc: IVpc;
}

export class N8nStack extends Stack {
  constructor(feature: Feature, id: string, private props: N8nStackProps) {
    super(feature, id, props);

    //TODO: Create secrets for database and n8n
    const dbSecret = new Secret(this, "PostgresSecret", {
      secretName: this.getFullName("postgres-credentials"),
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "n8n" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
      removalPolicy: this.props.removalPolicy,
    });

    const n8nEncryptionKey = new Secret(this, "N8nEncryptionKey", {
      secretName: this.getFullName("n8n-encryption-key"),
      generateSecretString: {
        excludePunctuation: false,
        includeSpace: false,
        passwordLength: 32,
      },
      removalPolicy: this.props.removalPolicy,
    });

    const n8nApiKey = new Secret(this, "N8nApiKey", {
      secretName: this.getFullName("n8n-api-key"),
      generateSecretString: {
        excludePunctuation: false,
        includeSpace: false,
        passwordLength: 64,
      },
      removalPolicy: this.props.removalPolicy,
    });

    //TODO: Create PostgreSQL Aurora Serverless cluster do we have a permission to create it?
    const dbCluster = new DatabaseCluster(this, "PostgresCluster", {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: Credentials.fromSecret(dbSecret),
      defaultDatabaseName: "n8n",
      instanceProps: {
        vpc: this.props.vpc,
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
        securityGroups: [this.props.securityGroups.getPostgresSecurityGroup()],
      },
      removalPolicy: this.props.removalPolicy,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 1,
    });

    //TODO: Create Redis cluster do we have a permission to create it?
    const redisSubnetGroup = new CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Subnet group for Redis",
      subnetIds: this.props.vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
    });

    //TODO: Create Redis cluster do we have a permission to create it?
    const redisCluster = new CfnCacheCluster(this, "RedisCluster", {
      cacheNodeType: "cache.t4g.micro",
      engine: "redis",
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [
        this.props.securityGroups.getRedisSecurityGroup().securityGroupId,
      ],
    });

    //TODO: Create ECS cluster do we have a permission to create it?
    const cluster = new Cluster(this, "N8nCluster", {
      clusterName: this.getFullName("n8n-cluster"),
      vpc: this.props.vpc,
      containerInsights: true,
    });

    //TODO: Create the load balancer do we have a permission to create it?
    const loadBalancer = new ApplicationLoadBalancer(this, "N8nLoadBalancer", {
      vpc: this.props.vpc,
      internetFacing: true,
      loadBalancerName: this.getFullName("n8n-lb"),
      securityGroup: this.props.securityGroups.getLoadBalancerSecurityGroup(),
    });

    // HTTP listener
    const httpListener = loadBalancer.addListener("HttpListener", {
      port: 80,
      open: true,
      defaultAction: ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    // HTTPS listener
    const httpsListener = loadBalancer.addListener("HttpsListener", {
      port: 443,
      open: true,
      defaultAction: ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "No routes matched",
      }),
    });

    //TODO: Task execution role do we have a permission to create it?
    const executionRole = new Role(this, "N8nTaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });

    //TODO: Task role do we have a permission to create it?
    const taskRole = new Role(this, "N8nTaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Allow task to read secrets
    dbSecret.grantRead(executionRole);
    n8nEncryptionKey.grantRead(executionRole);
    n8nApiKey.grantRead(executionRole);

    //TODO: Create task definition for n8n do we have a permission to create it?
    const n8nTaskDefinition = new FargateTaskDefinition(
      this,
      "N8nTaskDefinition",
      {
        memoryLimitMiB: 2048,
        cpu: 1024,
        executionRole,
        taskRole,
      }
    );

    n8nTaskDefinition.addContainer("n8n", {
      image: ContainerImage.fromRegistry("n8nio/n8n:latest"),
      essential: true,
      logging: LogDrivers.awsLogs({
        streamPrefix: "n8n",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      portMappings: [
        {
          containerPort: 5678,
          protocol: Protocol.TCP,
        },
      ],
      environment: {
        N8N_HOST: "localhost",
        N8N_PORT: "5678",
        N8N_PROTOCOL: "https",
        DB_TYPE: "postgresdb",
        DB_POSTGRESDB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_POSTGRESDB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_POSTGRESDB_DATABASE: "n8n",
        EXECUTIONS_MODE: "queue",
        QUEUE_BULL_REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        QUEUE_BULL_REDIS_PORT: redisCluster.attrRedisEndpointPort,
        N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
        N8N_RUNNERS_ENABLED: "true",
        OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS: "true",
      },
      secrets: {
        N8N_ENCRYPTION_KEY: EcsSecret.fromSecretsManager(n8nEncryptionKey),
        N8N_API_KEY: EcsSecret.fromSecretsManager(n8nApiKey),
        DB_POSTGRESDB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"),
        DB_POSTGRESDB_PASSWORD: EcsSecret.fromSecretsManager(
          dbSecret,
          "password"
        ),
      },
    });

    //TODO: Create task definition for n8n worker do we have a permission to create it?
    const n8nWorkerTaskDefinition = new FargateTaskDefinition(
      this,
      "N8nWorkerTaskDefinition",
      {
        memoryLimitMiB: 2048,
        cpu: 1024,
        executionRole,
        taskRole,
      }
    );

    n8nWorkerTaskDefinition.addContainer("n8n-worker", {
      image: ContainerImage.fromRegistry("n8nio/n8n:latest"),
      essential: true,
      logging: LogDrivers.awsLogs({
        streamPrefix: "n8n-worker",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      command: ["worker"],
      environment: {
        DB_TYPE: "postgresdb",
        DB_POSTGRESDB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_POSTGRESDB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_POSTGRESDB_DATABASE: "n8n",
        EXECUTIONS_MODE: "queue",
        QUEUE_BULL_REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        QUEUE_BULL_REDIS_PORT: redisCluster.attrRedisEndpointPort,
        N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
        N8N_RUNNERS_ENABLED: "true",
        OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS: "true",
      },
      secrets: {
        N8N_ENCRYPTION_KEY: EcsSecret.fromSecretsManager(n8nEncryptionKey),
        DB_POSTGRESDB_USER: EcsSecret.fromSecretsManager(dbSecret, "username"),
        DB_POSTGRESDB_PASSWORD: EcsSecret.fromSecretsManager(
          dbSecret,
          "password"
        ),
      },
    });

    //TODO: Create task definition for MCP server do we have a permission to create it?
    const mcpServerTaskDefinition = new FargateTaskDefinition(
      this,
      "McpServerTaskDefinition",
      {
        memoryLimitMiB: 1024,
        cpu: 512,
        executionRole,
        taskRole,
      }
    );

    // Create a CodeCommit repo for the MCP server code
    const mcpServerRepo = new CodeRepository(this, "McpServerRepository", {
      repositoryName: this.getFullName("mcp-server"),
      description: "Repository for MCP server code",
    });

    /**
     * The MCP server should use a custom-built image, not just amazonlinux:2. In a production setup, you would need to:
     * 1. Build the MCP server image
     * 2. Push it to a container registry (ECR)
     * 3. Reference that image in the task definition
     *
     * You would then need a CI/CD pipeline to build and push the MCP server image to this repository, similar to what's shown in the `yoonsoo-park/n8n-nabi` project's Dockerfile. shrug...
     */
    mcpServerTaskDefinition.addContainer("mcp-server", {
      image: ContainerImage.fromRegistry(
        "public.ecr.aws/amazonlinux/amazonlinux:2"
      ),
      essential: true,
      logging: LogDrivers.awsLogs({
        streamPrefix: "mcp-server",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      portMappings: [
        {
          containerPort: 1991,
          protocol: Protocol.TCP,
        },
        {
          containerPort: 1992,
          protocol: Protocol.TCP,
        },
      ],
      environment: {
        MCP_SERVER_PORT: "1991",
        MCP_SERVER_LOG_LEVEL: "info",
        NODE_ENV: "production",
        MCP_TRANSPORT_TYPE: "sse",
        MCP_SSE_ENABLED: "true",
        N8N_BASE_URL: "http://n8n-service:5678/api/v1",
      },
      secrets: {
        N8N_API_KEY: EcsSecret.fromSecretsManager(n8nApiKey), //TODO: IF we want to use n8n api key, we need to create a secret for it. do we have a permission to create it?
      },
    });

    // Create n8n service
    const n8nService = new FargateService(this, "N8nService", {
      cluster,
      taskDefinition: n8nTaskDefinition,
      desiredCount: 1,
      securityGroups: [this.props.securityGroups.getContainerSecurityGroup()],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      serviceName: this.getFullName("n8n-service"),
    });

    // Create n8n worker service
    const n8nWorkerService = new FargateService(this, "N8nWorkerService", {
      cluster,
      taskDefinition: n8nWorkerTaskDefinition,
      desiredCount: 1,
      securityGroups: [this.props.securityGroups.getContainerSecurityGroup()],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      serviceName: this.getFullName("n8n-worker-service"),
    });

    // Create MCP server service
    const mcpServerService = new FargateService(this, "McpServerService", {
      cluster,
      taskDefinition: mcpServerTaskDefinition,
      desiredCount: 1,
      securityGroups: [this.props.securityGroups.getContainerSecurityGroup()],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      serviceName: this.getFullName("mcp-server-service"),
    });

    // Add n8n to target group and ALB
    const n8nTargetGroup = httpsListener.addTargets("N8nTargetGroup", {
      port: 5678,
      targets: [n8nService],
      healthCheck: {
        path: "/healthz",
        interval: Duration.seconds(60),
        timeout: Duration.seconds(5),
      },
      deregistrationDelay: Duration.seconds(10),
    });

    // Create target group for MCP server
    const mcpServerTargetGroup = new ApplicationTargetGroup(
      this,
      "McpServerTargetGroup",
      {
        vpc: this.props.vpc,
        port: 1991,
        protocol: ApplicationProtocol.HTTP,
        targets: [mcpServerService],
        healthCheck: {
          path: "/healthz",
          interval: Duration.seconds(60),
          timeout: Duration.seconds(5),
        },
        deregistrationDelay: Duration.seconds(10),
      }
    );

    // Add listener rule for path-based routing to MCP server
    httpsListener.addAction("McpServerRule", {
      priority: 10,
      conditions: [ListenerCondition.pathPatterns(["/mcp*"])],
      action: ListenerAction.forward([mcpServerTargetGroup]),
    });

    // Export outputs
    this.exportValue(loadBalancer.loadBalancerDnsName, {
      name: this.getFullName("load-balancer-dns"),
    });
  }
}
