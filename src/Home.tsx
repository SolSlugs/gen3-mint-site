import { useCallback, useEffect, useState, useMemo } from 'react';
import * as anchor from '@project-serum/anchor';

import { Snackbar } from '@mui/material';
import Alert from '@mui/lab/Alert';
import { Commitment, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton, WalletDisconnectButton } from '@solana/wallet-adapter-react-ui';
import {
    awaitTransactionSignatureConfirmation,
    CANDY_MACHINE_PROGRAM,
    CandyMachineAccount,
    createAccountsForMint,
    getCandyMachineState,
    getCollectionPDA,
    mintOneToken,
    SetupState,
} from './candy-machine';
import { AlertState, getAtaForMint } from './utils';
import { MintButton } from './MintButton';
import { GatewayProvider } from '@civic/solana-gateway-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import Sealab from './sealab.mp3';

const walletButtonClasses = '!border-solid !border-2 md:!border-[3.5px] !border-primary !rounded-md !min-w-64 !h-10 !p-0 !bg-transparent !flex !flex-row !flex-nowrap !text-sm sm:!text-base !items-center !justify-center !font-normal';

const walletTextClasses = 'text-white px-3 font-header text-xs sm:text-sm md:text-lg whitespace-nowrap -ml-3 only:ml-0';


export interface HomeProps {
    candyMachineId?: anchor.web3.PublicKey;
    connection: anchor.web3.Connection;
    txTimeout: number;
    rpcHost: string;
    network: WalletAdapterNetwork;
    error?: string;
}

const Home = (props: HomeProps) => {
    const [isUserMinting, setIsUserMinting] = useState(false);
    const [candyMachine, setCandyMachine] = useState<CandyMachineAccount>();
    const [alertState, setAlertState] = useState<AlertState>({
        open: false,
        message: '',
        severity: undefined,
    });
    const [isActive, setIsActive] = useState(false);
    const [itemsRemaining, setItemsRemaining] = useState<number>();
    const [isWhitelistUser, setIsWhitelistUser] = useState(false);
    const [isPresale, setIsPresale] = useState(false);
    const [isValidBalance, setIsValidBalance] = useState(false);
    const [, setDiscountPrice] = useState<anchor.BN>();
    const [needTxnSplit, setNeedTxnSplit] = useState(true);
    const [setupTxn, setSetupTxn] = useState<SetupState>();
    const [balance, setBalance] = useState<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const canMint = useMemo(() => {
        return isActive || (isPresale && isWhitelistUser && isValidBalance);
    }, [isActive, isPresale, isWhitelistUser, isValidBalance]);

    const rpcUrl = props.rpcHost;
    const anchorWallet = useAnchorWallet();
    const { connected, publicKey } = useWallet();
    const cluster = props.network;

    const play = useCallback(() => {
        if (isPlaying) {
            return;
        }

        const audio = document.getElementById('audio');

        if (!audio) {
            return;
        }

        const a = audio as HTMLAudioElement;

        a.volume = 0.5;
        a.play();

        setIsPlaying(true);
    }, [isPlaying]);

    const playOnce = useCallback(() => {
        play();

        document.removeEventListener('click', playOnce);
        document.removeEventListener('scroll', playOnce);
    }, [play]);

    useEffect(() => {
        document.addEventListener('click', playOnce, { once: true });
        document.addEventListener('scroll', playOnce, { once: true });
    }, []);

    function stop() {
        if (!isPlaying) {
            return;
        }

        const audio = document.getElementById('audio');

        if (!audio) {
            return;
        }

        const a = audio as HTMLAudioElement;

        a.pause();

        setIsPlaying(false);
    }

    const refreshCandyMachineState = useCallback(
        async (commitment: Commitment = 'confirmed') => {
            if (!publicKey) {
                return;
            }
            if (props.error !== undefined) {
                setAlertState({
                    open: true,
                    message: props.error,
                    severity: 'error',
                    hideDuration: null,
                });
                return;
            }

            const connection = new Connection(props.rpcHost, commitment);

            if (props.candyMachineId) {
                try {
                    const cndy = await getCandyMachineState(
                        anchorWallet as anchor.Wallet,
                        props.candyMachineId,
                        connection
                    );
                    console.log('Candy machine state: ', cndy);
                    let active = cndy?.state.goLiveDate
                        ? cndy?.state.goLiveDate.toNumber() < new Date().getTime() / 1000
                        : false;
                    let presale = false;

                    // duplication of state to make sure we have the right values!
                    let isWLUser = false;
                    let userPrice = cndy.state.price;

                    // whitelist mint?
                    if (cndy?.state.whitelistMintSettings) {
                        // is it a presale mint?
                        if (
                            cndy.state.whitelistMintSettings.presale &&
                            (!cndy.state.goLiveDate || cndy.state.goLiveDate.toNumber() > new Date().getTime() / 1000)
                        ) {
                            presale = true;
                        }
                        // is there a discount?
                        if (cndy.state.whitelistMintSettings.discountPrice) {
                            setDiscountPrice(cndy.state.whitelistMintSettings.discountPrice);
                            userPrice = cndy.state.whitelistMintSettings.discountPrice;
                        } else {
                            setDiscountPrice(undefined);
                            // when presale=false and discountPrice=null, mint is restricted
                            // to whitelist users only
                            if (!cndy.state.whitelistMintSettings.presale) {
                                cndy.state.isWhitelistOnly = true;
                            }
                        }
                        // retrieves the whitelist token
                        const mint = new anchor.web3.PublicKey(cndy.state.whitelistMintSettings.mint);
                        const token = (await getAtaForMint(mint, publicKey))[0];

                        try {
                            const balance = await connection.getTokenAccountBalance(token);
                            isWLUser = parseInt(balance.value.amount) > 0;
                            // only whitelist the user if the balance > 0
                            setIsWhitelistUser(isWLUser);

                            if (cndy.state.isWhitelistOnly) {
                                active = isWLUser && (presale || active);
                            }
                        } catch (e) {
                            setIsWhitelistUser(false);
                            // no whitelist user, no mint
                            if (cndy.state.isWhitelistOnly) {
                                active = false;
                            }
                            console.log('There was a problem fetching whitelist token balance');
                            console.log(e);
                        }
                    }
                    userPrice = isWLUser ? userPrice : cndy.state.price;

                    if (cndy?.state.tokenMint) {
                        // retrieves the SPL token
                        const mint = new anchor.web3.PublicKey(cndy.state.tokenMint);
                        const token = (await getAtaForMint(mint, publicKey))[0];
                        try {
                            const balance = await connection.getTokenAccountBalance(token);

                            setBalance(Number(balance.value.amount));

                            const valid = new anchor.BN(balance.value.amount).gte(userPrice);

                            // only allow user to mint if token balance >  the user if the balance > 0
                            setIsValidBalance(valid);
                            active = active && valid;
                        } catch (e) {
                            setBalance(0);
                            setIsValidBalance(false);
                            active = false;
                            // no whitelist user, no mint
                            console.log('There was a problem fetching SPL token balance');
                            console.log(e);
                        }
                    } else {
                        const balance = new anchor.BN(await connection.getBalance(publicKey));
                        const valid = balance.gte(userPrice);
                        setIsValidBalance(valid);
                        active = active && valid;
                    }

                    // datetime to stop the mint?
                    if (cndy?.state.endSettings?.endSettingType.date) {
                        if (cndy.state.endSettings.number.toNumber() < new Date().getTime() / 1000) {
                            active = false;
                        }
                    }
                    // amount to stop the mint?
                    if (cndy?.state.endSettings?.endSettingType.amount) {
                        const limit = Math.min(cndy.state.endSettings.number.toNumber(), cndy.state.itemsAvailable);
                        if (cndy.state.itemsRedeemed < limit) {
                            setItemsRemaining(limit - cndy.state.itemsRedeemed);
                        } else {
                            setItemsRemaining(0);
                            cndy.state.isSoldOut = true;
                        }
                    } else {
                        setItemsRemaining(cndy.state.itemsRemaining);
                    }

                    if (cndy.state.isSoldOut) {
                        active = false;
                    }

                    const [collectionPDA] = await getCollectionPDA(props.candyMachineId);
                    const collectionPDAAccount = await connection.getAccountInfo(collectionPDA);

                    setIsActive((cndy.state.isActive = active));
                    setIsPresale((cndy.state.isPresale = presale));
                    setCandyMachine(cndy);

                    const txnEstimate =
                        892 +
                        (!!collectionPDAAccount && cndy.state.retainAuthority ? 182 : 0) +
                        (cndy.state.tokenMint ? 66 : 0) +
                        (cndy.state.whitelistMintSettings ? 34 : 0) +
                        (cndy.state.whitelistMintSettings?.mode?.burnEveryTime ? 34 : 0) +
                        (cndy.state.gatekeeper ? 33 : 0) +
                        (cndy.state.gatekeeper?.expireOnUse ? 66 : 0);

                    setNeedTxnSplit(txnEstimate > 1230);
                } catch (e) {
                    if (e instanceof Error) {
                        if (e.message === `Account does not exist ${props.candyMachineId}`) {
                            setAlertState({
                                open: true,
                                message: `Couldn't fetch candy machine state from candy machine with address: ${props.candyMachineId}, using rpc: ${props.rpcHost}! You probably typed the REACT_APP_CANDY_MACHINE_ID value wrong in your .env file, or you are using the wrong RPC!`,
                                severity: 'error',
                                hideDuration: null,
                            });
                        } else if (e.message.startsWith('failed to get info about account')) {
                            setAlertState({
                                open: true,
                                message: `Couldn't fetch candy machine state with rpc: ${props.rpcHost}! This probably means you have an issue with the REACT_APP_SOLANA_RPC_HOST value in your .env file, or you are not using a custom RPC!`,
                                severity: 'error',
                                hideDuration: null,
                            });
                        }
                    } else {
                        setAlertState({
                            open: true,
                            message: `${e}`,
                            severity: 'error',
                            hideDuration: null,
                        });
                    }
                    console.log(e);
                }
            } else {
                setAlertState({
                    open: true,
                    message: `Your REACT_APP_CANDY_MACHINE_ID value in the .env file doesn't look right! Make sure you enter it in as plain base-58 address!`,
                    severity: 'error',
                    hideDuration: null,
                });
            }
        },
        [anchorWallet, props.candyMachineId, props.error, props.rpcHost]
    );

    const onMint = async (beforeTransactions: Transaction[] = [], afterTransactions: Transaction[] = []) => {
        try {
            setIsUserMinting(true);
            if (connected && candyMachine?.program && publicKey) {
                let setupMint: SetupState | undefined;
                if (needTxnSplit && setupTxn === undefined) {
                    setAlertState({
                        open: true,
                        message: 'Please sign account setup transaction',
                        severity: 'info',
                    });
                    setupMint = await createAccountsForMint(candyMachine, publicKey);
                    let status: any = { err: true };
                    if (setupMint.transaction) {
                        status = await awaitTransactionSignatureConfirmation(
                            setupMint.transaction,
                            props.txTimeout,
                            props.connection,
                            true
                        );
                    }
                    if (status && !status.err) {
                        setSetupTxn(setupMint);
                        setAlertState({
                            open: true,
                            message: 'Setup transaction succeeded! Please sign minting transaction',
                            severity: 'info',
                        });
                    } else {
                        setAlertState({
                            open: true,
                            message: 'Mint failed! Please try again!',
                            severity: 'error',
                        });
                        setIsUserMinting(false);
                        return;
                    }
                } else {
                    setAlertState({
                        open: true,
                        message: 'Please sign minting transaction',
                        severity: 'info',
                    });
                }

                const mintResult = await mintOneToken(
                    candyMachine,
                    publicKey,
                    beforeTransactions,
                    afterTransactions,
                    setupMint ?? setupTxn
                );

                let status: any = { err: true };
                let metadataStatus = null;
                if (mintResult) {
                    status = await awaitTransactionSignatureConfirmation(
                        mintResult.mintTxId,
                        props.txTimeout,
                        props.connection,
                        true
                    );

                    metadataStatus = await candyMachine.program.provider.connection.getAccountInfo(
                        mintResult.metadataKey,
                        'processed'
                    );
                    console.log('Metadata status: ', !!metadataStatus);
                }

                if (status && !status.err && metadataStatus) {
                    // manual update since the refresh might not detect
                    // the change immediately
                    const remaining = itemsRemaining! - 1;
                    setItemsRemaining(remaining);
                    setIsActive((candyMachine.state.isActive = remaining > 0));
                    candyMachine.state.isSoldOut = remaining === 0;
                    setSetupTxn(undefined);
                    setAlertState({
                        open: true,
                        message: 'Congratulations! Mint succeeded!',
                        severity: 'success',
                        hideDuration: 7000,
                    });
                    refreshCandyMachineState('processed');
                } else if (status && !status.err) {
                    setAlertState({
                        open: true,
                        message:
                            'Mint likely failed! Anti-bot SOL 0.01 fee potentially charged! Check the explorer to confirm the mint failed and if so, make sure you are eligible to mint before trying again.',
                        severity: 'error',
                        hideDuration: 8000,
                    });
                    refreshCandyMachineState();
                } else {
                    setAlertState({
                        open: true,
                        message: 'Mint failed! Please try again!',
                        severity: 'error',
                    });
                    refreshCandyMachineState();
                }
            }
        } catch (error: any) {
            let message = error.msg || 'Minting failed! Please try again!';
            if (!error.msg) {
                if (!error.message) {
                    message = 'Transaction timeout! Please try again.';
                } else if (error.message.indexOf('0x137')) {
                    console.log(error);
                    message = `SOLD OUT!`;
                } else if (error.message.indexOf('0x135')) {
                    message = `Insufficient funds to mint. Please fund your wallet.`;
                }
            } else {
                if (error.code === 311) {
                    console.log(error);
                    message = `SOLD OUT!`;
                    window.location.reload();
                } else if (error.code === 312) {
                    message = `Minting period hasn't started yet.`;
                }
            }

            setAlertState({
                open: true,
                message,
                severity: 'error',
            });
            // updates the candy machine state to reflect the latest
            // information on chain
            refreshCandyMachineState();
        } finally {
            setIsUserMinting(false);
        }
    };

    useEffect(() => {
        refreshCandyMachineState();
    }, [anchorWallet, props.candyMachineId, props.connection, refreshCandyMachineState]);

    useEffect(() => {
        (function loop() {
            setTimeout(() => {
                refreshCandyMachineState();
                loop();
            }, 20000);
        })();
    }, [refreshCandyMachineState]);

    const connectComponent = (
        <WalletMultiButton
            className={walletButtonClasses}
        >
            <span className={walletTextClasses}>
                Connect Wallet
            </span>
        </WalletMultiButton>
    );

    const disconnectComponent = (
        <WalletDisconnectButton
            className={walletButtonClasses}
        >
            <span className={walletTextClasses}>
                Disconnect Wallet
            </span>
        </WalletDisconnectButton>
    );

    const connectedComponent = (
        <>
            {candyMachine && (
                <div
                    style={{
                        display: 'grid',
                        columnGap: '10px',
                        justifyContent: 'space-around',
                        alignItems: 'center',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        <span className='text-primary font-header text-lg' style={{ textAlign: 'center' }}>
                            Items Remaining
                        </span>

                        <span className='text-primary' style={{ fontSize: '28px', textAlign: 'center' }}>
                            {itemsRemaining}
                        </span>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        <span className='text-primary font-header text-lg' style={{ textAlign: 'center' }}>
                            Price
                        </span>

                        <span className='text-primary' style={{ fontSize: '28px', textAlign: 'center' }}>
                            Free with Gen 3 Mint Token
                        </span>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        <span className='text-primary font-header text-lg' style={{ textAlign: 'center' }}>
                            Your Mint Token Balance
                        </span>

                        <span className='text-primary' style={{ fontSize: '28px', textAlign: 'center' }}>
                            {balance}
                        </span>
                    </div>
                </div>
            )}

            {canMint && (
                <div style={{ marginTop: '40px' }} className='flex items-center justify-center'>
                    {candyMachine?.state.isActive &&
                    candyMachine?.state.gatekeeper &&
                    publicKey &&
                    anchorWallet?.signTransaction ? (
                        <GatewayProvider
                            wallet={{
                                publicKey: publicKey || new PublicKey(CANDY_MACHINE_PROGRAM),
                                signTransaction: anchorWallet.signTransaction,
                            }}
                            gatekeeperNetwork={candyMachine?.state?.gatekeeper?.gatekeeperNetwork}
                            clusterUrl={rpcUrl}
                            cluster={cluster}
                            options={{ autoShowModal: false }}
                        >
                            <MintButton
                                candyMachine={candyMachine}
                                isMinting={isUserMinting}
                                setIsMinting={(val) => setIsUserMinting(val)}
                                onMint={onMint}
                                isActive={isActive || (isPresale && isWhitelistUser && isValidBalance)}
                            />
                        </GatewayProvider>
                    ) : (
                        <MintButton
                            candyMachine={candyMachine}
                            isMinting={isUserMinting}
                            setIsMinting={(val) => setIsUserMinting(val)}
                            onMint={onMint}
                            isActive={isActive || (isPresale && isWhitelistUser && isValidBalance)}
                        />
                    )}
                </div>
            )}

            {!canMint && balance !== null && (
                <div style={{ marginTop: '40px' }} className='flex items-center justify-center'>
                    <span className='text-primary' style={{ fontSize: '36px' }}>
                        Unfortunately, it looks like you have no gen 3 mint tokens remaining.
                    </span>
                </div>
            )}
        </>
    );

    return (
        <div className='flex items-center justify-center' style={{ flexDirection: 'column' }}>
            <audio
                style={{
                    display: 'hidden',
                }}
                src={Sealab}
                id='audio'
                loop
            />

            <div className='w-4/5 flex mt-20 items-center justify-center' style={{ flexDirection: 'column' }}>
                <span className='font-header text-primary'>
                    Gen 3 Mint!
                </span>

                <div className='flex' style={{ marginBottom: '40px', marginTop: '20px', justifyContent: 'end', width: '100%' }}>
                    {!connected ? connectComponent : disconnectComponent}
                </div>

                {connected && connectedComponent}

                <Snackbar
                    open={alertState.open}
                    autoHideDuration={alertState.hideDuration === undefined ? 6000 : alertState.hideDuration}
                    onClose={() => setAlertState({ ...alertState, open: false })}
                >
                    <Alert onClose={() => setAlertState({ ...alertState, open: false })} severity={alertState.severity}>
                        {alertState.message}
                    </Alert>
                </Snackbar>
            </div>

            <button
                onClick={isPlaying ? stop : play}
                className='!border-solid !border-2 md:!border-[3.5px] !border-primary !rounded-md !bg-transparent !flex !flex-row !flex-nowrap !text-sm sm:!text-base !items-center !justify-center !font-normal text-white px-3 font-header text-xs sm:text-sm md:text-lg whitespace-nowrap only:ml-0'
                style={{ marginTop: '80px', padding: '10px' }}
            >
                {isPlaying ? 'Stop Music' : 'Play Music'}
            </button>
        </div>
    );
};

export default Home;
