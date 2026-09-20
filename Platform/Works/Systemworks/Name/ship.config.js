export default {
  blocks: {
    web: {
      command: 'npm start',
      expose: true,
      healthCheck: { port: 4227 },
    },
  },
};
