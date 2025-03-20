export default {
  idl: './jito_restaking.json',
  before: [
  ],
  scripts: {
    rust: {
      from: '@codama/renderers-rust',
      args: [
        'deps/restaking_client/src/generated',
        {
          crateFolder: 'deps/restaking_client',
          formatCode: true,
        }
      ]
    }
  }
}
