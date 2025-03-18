import { Stack } from "@ncino/aws-cdk";
import { IVpc, Peer, Port, SecurityGroup } from "aws-cdk-lib/aws-ec2";

export class SecurityGroups {
  private redisSecurityGroup: SecurityGroup;
  private postgresSecurityGroup: SecurityGroup;
  private containerSecurityGroup: SecurityGroup;
  private loadBalancerSecurityGroup: SecurityGroup;

  constructor(stack: Stack, vpc: IVpc) {
    //TODO: Security group for PostgreSQL do we have a permission to create it?
    this.postgresSecurityGroup = new SecurityGroup(
      stack,
      "PostgresSecurityGroup",
      {
        securityGroupName: stack.getFullName("postgresSecurityGroup"),
        description: `Security group for PostgreSQL database`,
        vpc,
      }
    );
    stack.exportValue(this.postgresSecurityGroup.securityGroupId);

    //TODO: Security group for Redis do we have a permission to create it?
    this.redisSecurityGroup = new SecurityGroup(stack, "RedisSecurityGroup", {
      securityGroupName: stack.getFullName("redisSecurityGroup"),
      description: `Security group for Redis cache`,
      vpc,
    });
    stack.exportValue(this.redisSecurityGroup.securityGroupId);

    // Security group for n8n and MCP containers
    this.containerSecurityGroup = new SecurityGroup(
      stack,
      "ContainerSecurityGroup",
      {
        securityGroupName: stack.getFullName("containerSecurityGroup"),
        description: `Security group for n8n and MCP containers`,
        vpc,
      }
    );
    stack.exportValue(this.containerSecurityGroup.securityGroupId, {
      name: stack.getFullName("container-sg-id"),
    });

    // Security group for load balancer
    this.loadBalancerSecurityGroup = new SecurityGroup(
      stack,
      "LbSecurityGroup",
      {
        securityGroupName: stack.getFullName("lbSecurityGroup"),
        description: "Security Group for the ALB",
        vpc,
      }
    );
    stack.exportValue(this.loadBalancerSecurityGroup.securityGroupId, {
      name: stack.getFullName("alb-sg-id"),
    });

    this.setupPostgresSecurityGroupRules();
    this.setupRedisSecurityGroupRules();
    this.setupContainerSecurityGroupRules();
    this.setupLoadBalancerSecurityGroupRules();
  }

  private setupPostgresSecurityGroupRules() {
    // Allow traffic from containers to Postgres
    this.postgresSecurityGroup.addIngressRule(
      Peer.securityGroupId(this.containerSecurityGroup.securityGroupId),
      Port.tcp(5432),
      "Allow PostgreSQL traffic from containers"
    );
  }

  private setupRedisSecurityGroupRules() {
    // Allow traffic from containers to Redis
    this.redisSecurityGroup.addIngressRule(
      Peer.securityGroupId(this.containerSecurityGroup.securityGroupId),
      Port.tcp(6379),
      "Allow Redis traffic from containers"
    );
  }

  private setupContainerSecurityGroupRules() {
    // Allow traffic from ALB to containers
    this.containerSecurityGroup.addIngressRule(
      Peer.securityGroupId(this.loadBalancerSecurityGroup.securityGroupId),
      Port.tcp(5678),
      "Allow traffic from ALB to n8n"
    );

    this.containerSecurityGroup.addIngressRule(
      Peer.securityGroupId(this.loadBalancerSecurityGroup.securityGroupId),
      Port.tcp(1991),
      "Allow traffic from ALB to MCP server"
    );

    // Allow outbound traffic to Postgres
    this.containerSecurityGroup.addEgressRule(
      Peer.securityGroupId(this.postgresSecurityGroup.securityGroupId),
      Port.tcp(5432),
      "Allow outbound to PostgreSQL"
    );

    // Allow outbound traffic to Redis
    this.containerSecurityGroup.addEgressRule(
      Peer.securityGroupId(this.redisSecurityGroup.securityGroupId),
      Port.tcp(6379),
      "Allow outbound to Redis"
    );

    // Allow containers to communicate with each other
    this.containerSecurityGroup.addIngressRule(
      Peer.securityGroupId(this.containerSecurityGroup.securityGroupId),
      Port.allTraffic(),
      "Allow containers to communicate with each other"
    );

    // Allow outbound internet access for pulling images, etc.
    this.containerSecurityGroup.addEgressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      "Allow outbound HTTPS"
    );

    this.containerSecurityGroup.addEgressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "Allow outbound HTTP"
    );
  }

  private setupLoadBalancerSecurityGroupRules() {
    // Allow inbound traffic to ALB
    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "Allow HTTP traffic to ALB"
    );

    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      "Allow HTTPS traffic to ALB"
    );

    // Allow outbound traffic from ALB to containers
    this.loadBalancerSecurityGroup.addEgressRule(
      Peer.securityGroupId(this.containerSecurityGroup.securityGroupId),
      Port.tcp(5678),
      "Allow traffic to n8n containers"
    );

    this.loadBalancerSecurityGroup.addEgressRule(
      Peer.securityGroupId(this.containerSecurityGroup.securityGroupId),
      Port.tcp(1991),
      "Allow traffic to MCP server"
    );
  }

  public getPostgresSecurityGroup(): SecurityGroup {
    return this.postgresSecurityGroup;
  }

  public getRedisSecurityGroup(): SecurityGroup {
    return this.redisSecurityGroup;
  }

  public getContainerSecurityGroup(): SecurityGroup {
    return this.containerSecurityGroup;
  }

  public getLoadBalancerSecurityGroup(): SecurityGroup {
    return this.loadBalancerSecurityGroup;
  }
}
