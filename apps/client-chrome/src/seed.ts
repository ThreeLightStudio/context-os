import type { AppData, SavedTab } from './types'
import { DEFAULT_BRAIN_SERVER_URL } from './config'

const createdAt = new Date().toISOString()

export const sampleTabs: SavedTab[] = [
  {
    id: 'tab-stripe',
    title: 'Payments - Stripe Dashboard',
    url: 'https://dashboard.stripe.com/payments',
    domain: 'dashboard.stripe.com',
    surface: 'Money'
  },
  {
    id: 'tab-github',
    title: 'Beta license activation issue',
    url: 'https://github.com/threelight/mapbridge/issues/42',
    domain: 'github.com',
    surface: 'Code'
  },
  {
    id: 'tab-store',
    title: 'App Store Connect - Subscriptions',
    url: 'https://appstoreconnect.apple.com/apps',
    domain: 'appstoreconnect.apple.com',
    surface: 'Store'
  },
  {
    id: 'tab-thread',
    title: 'Launch thread draft',
    url: 'https://www.threads.net/',
    domain: 'threads.net',
    surface: 'SNS'
  }
]

export const seedData: AppData = {
  schemaVersion: 3,
  activeProjectId: 'project-mapbridge',
  projects: [
    {
      id: 'project-mapbridge',
      name: 'MapBridge',
      color: '#3a7d5c',
      pinned: true,
      createdAt
    },
    {
      id: 'project-studio',
      name: 'ThreeLight Studio',
      color: '#4a6fa5',
      pinned: true,
      createdAt
    },
    {
      id: 'project-sns',
      name: 'SNS Marketing',
      color: '#a98a3c',
      createdAt
    }
  ],
  sessions: [
    {
      id: 'session-mapbridge-pricing',
      projectId: 'project-mapbridge',
      name: 'Pricing QA before beta launch',
      note:
        'Checking Stripe checkout, beta license copy, and invalid activation states before sharing the launch page.',
      nextAction: 'Test invalid license message in extension.',
      createdAt,
      tabs: sampleTabs
    }
  ],
  memories: [
    {
      id: 'memory-stripe-beta',
      projectId: 'project-mapbridge',
      url: 'https://dashboard.stripe.com/payments',
      domain: 'dashboard.stripe.com',
      surface: 'Money',
      note: 'Use one-time beta license wording. Avoid subscription dashboard in extension.',
      createdAt
    },
    {
      id: 'memory-stripe-launch',
      projectId: 'project-sns',
      url: 'https://dashboard.stripe.com/payments',
      domain: 'dashboard.stripe.com',
      surface: 'Money',
      note: 'Checkout URL goes in launch checklist after support inbox is ready.',
      createdAt
    }
  ],
  license: {
    plan: 'free'
  },
  sync: {
    mode: 'local',
    setupComplete: false,
    endpointUrl: '',
    brainEndpointUrl: DEFAULT_BRAIN_SERVER_URL,
    outbox: [],
    developerMode: false
  }
}
