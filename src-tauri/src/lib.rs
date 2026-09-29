//! miclaw_api_bridge: bridge Super XiaoAI's MiMo into local OpenAI/Claude compatible APIs.

pub mod auth;
pub mod decode;
pub mod error;
pub mod mimo;
pub mod proxy;
pub mod security;
pub mod server;
pub mod service;
pub mod state;
pub mod storage;
pub mod usage;

pub fn init_tracing() {
    // Default to info: the auth module's debug! hop logs can carry URLs whose
    // query strings embed bearer-equivalent STS credentials, and mimo debug
    // lines are chatty. Opt into debug with RUST_LOG=debug when diagnosing.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();
}
