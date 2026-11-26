import agentConnect from "@/assets/work-previews/agent-connect.webp";
import cityNodes from "@/assets/work-previews/city-nodes.webp";
import hackathonBot from "@/assets/work-previews/hackathon-bot.webp";
import legionCreatorProgram from "@/assets/work-previews/legion-creator-program.webp";
import nbsmm from "@/assets/work-previews/nbsmm.webp";
import nearEduContent from "@/assets/work-previews/near-edu-content.webp";
import nearbuildersGrowth from "@/assets/work-previews/nearbuilders-growth.webp";
import nearbuildersBot from "@/assets/work-previews/nearbuildersbot.webp";
import nearbuildersOrg from "@/assets/work-previews/nearbuildersorg.webp";
import nostr from "@/assets/work-previews/nostr.webp";
import paymentsPlugin from "@/assets/work-previews/payments-plugin.webp";
import pingOnramp from "@/assets/work-previews/pingonramp.webp";
import pingPay from "@/assets/work-previews/pingpay.webp";

export type WorkDemoProject = {
  slug: string;
  title: string;
  status: "active";
  repository?: string;
  description: string;
  preview: { image: string; url: string; label: string };
};

export const workDemoProjects: readonly WorkDemoProject[] = [
  {
    slug: "near-edu-content",
    title: "NEAR Edu Content",
    status: "active",
    repository: "https://github.com/near",
    description:
      "Educational content for developers learning NEAR, from deploying a first smart contract to building and connecting a web app.",
    preview: { image: nearEduContent, url: "https://docs.near.org/", label: "NEAR developer docs" },
  },
  {
    slug: "nearbuilders-growth",
    title: "NearBuilders Growth",
    status: "active",
    repository: "https://github.com/nearbuilders",
    description:
      "Community growth for NEAR Builders, helping developers find entry points, meet collaborators, and get involved in open projects.",
    preview: {
      image: nearbuildersGrowth,
      url: "https://nearbuilders.org/build",
      label: "NEAR Builders community page",
    },
  },
  {
    slug: "hackathon-bot",
    title: "hackathon-bot",
    status: "active",
    repository: "https://github.com/nearbuilders/hackathon-bot",
    description:
      "A Telegram and Discord bot that helps NEAR Hackathon participants find rules, deadlines, track details, and guidance for building and submitting projects.",
    preview: {
      image: hackathonBot,
      url: "https://github.com/nearbuilders/hackathon-bot",
      label: "GitHub repository",
    },
  },
  {
    slug: "agent-connect",
    title: "Agent Connect",
    status: "active",
    repository: "https://github.com/NEAR-Intents-Agent-API",
    description:
      "A developer toolkit for giving AI agents their own NEAR Intents wallets, with actions limited to rules approved by the wallet owner.",
    preview: {
      image: agentConnect,
      url: "https://docs.agentsonintents.com/integration/agent-api/overview",
      label: "NEAR Intents Agent API docs",
    },
  },
  {
    slug: "pingpay",
    title: "PingPay",
    status: "active",
    repository: "https://github.com/Pingpayio",
    description:
      "Cross-chain payment tools for sending and receiving crypto, including hosted checkout links that can settle payments in a recipient's preferred asset.",
    preview: { image: pingPay, url: "https://pingpay.io/", label: "Project homepage" },
  },
  {
    slug: "payments-plugin",
    title: "pay.everything.dev",
    status: "active",
    repository: "https://github.com/NEARBuilders/payment-aggregator",
    description:
      "A payment aggregator that routes checkout, webhooks, and status checks through a shared contract for providers such as Stripe and PingPay.",
    preview: {
      image: paymentsPlugin,
      url: "https://pay.everything.dev/",
      label: "Project homepage",
    },
  },
  {
    slug: "legion-creator-program",
    title: "Legion Creator Program",
    status: "active",
    repository: "https://docs.google.com/document/d/1nQNOH3km4OHdoPsGQ25xM6HdM_MtjHi5vWXqSZd67yw",
    description:
      "A creator initiative within NEAR Legion, a global community that brings people into the NEAR ecosystem through missions, events, and contributions.",
    preview: {
      image: legionCreatorProgram,
      url: "https://nearlegion.com/",
      label: "NEAR Legion homepage",
    },
  },
  {
    slug: "nostr",
    title: "nostr.nearbuilders.org",
    status: "active",
    repository: "https://github.com/nearbuilders/nostr.nearbuilders.org",
    description:
      "A bridge between NEAR accounts and Nostr that lets users bind a Nostr identity on-chain and post signed comments to public relays.",
    preview: { image: nostr, url: "https://nostr.nearbuilders.org/", label: "Project homepage" },
  },
  {
    slug: "pingonramp",
    title: "onramp.pingpay.io",
    status: "active",
    repository: "https://github.com/Pingpayio/ping-onramp-example",
    description:
      "A fiat-to-crypto on-ramp and SDK integration example that shows developers how to launch a purchase flow inside their own apps.",
    preview: {
      image: pingOnramp,
      url: "https://github.com/Pingpayio/ping-onramp-example",
      label: "On-ramp SDK example",
    },
  },
  {
    slug: "city-nodes",
    title: "citynode.app",
    status: "active",
    repository: "https://github.com/NEARBuilders/citynode.app",
    description:
      "A network of local NEAR validator communities. Find a chapter, explore events, and stake NEAR to support a node in your city or region.",
    preview: { image: cityNodes, url: "https://citynode.app/", label: "Project homepage" },
  },
  {
    slug: "nearbuildersorg",
    title: "nearbuilders.org",
    status: "active",
    repository: "https://github.com/NEARBuilders/nearbuilders.org",
    description:
      "The NEAR Builders community platform, where builders can create profiles, share projects, find collaborators, and discover ecosystem events.",
    preview: {
      image: nearbuildersOrg,
      url: "https://nearbuilders.org/",
      label: "Project homepage",
    },
  },
  {
    slug: "nbsmm",
    title: "NEAR Builders Social Media Management",
    status: "active",
    repository: "https://github.com/NEARBuilders/nearbuilders.org",
    description:
      "Social media campaigns that highlight projects and builders and point the NEAR community toward events, resources, and ways to contribute.",
    preview: {
      image: nbsmm,
      url: "https://multiagency.ai/work/nbsmm",
      label: "MultiAgency project listing",
    },
  },
  {
    slug: "nearbuildersbot",
    title: "NEAR Builders Bot",
    status: "active",
    repository: "https://github.com/NEARBuilders/bot.nearbuilders.org",
    description:
      "A Telegram bot that automates builder nominations and onboarding for nearbuilders.org.",
    preview: {
      image: nearbuildersBot,
      url: "https://github.com/NEARBuilders/bot.nearbuilders.org",
      label: "GitHub repository",
    },
  },
];
