import ctypes
import os
import json
import base64
import sys
import hashlib
import platform
from flask import Flask, request, jsonify
from flask_cors import CORS
from typing import Optional

from asn1crypto import cms, core, tsp, x509

# Map ESSCertIDv2 to its OID
class SetOfSigningCertificateV2(core.SetOf):
    _child_spec = tsp.SigningCertificateV2

cms.CMSAttributeType._map['1.2.840.113549.1.9.16.2.47'] = 'signing_certificate_v2'
cms.CMSAttribute._oid_specs['signing_certificate_v2'] = SetOfSigningCertificateV2

app = Flask(__name__)
CORS(app)

# PKCS11 Constants & Types
CKR_OK = 0
CKU_USER = 1
CKA_CLASS = 0x00000000
CKO_PRIVATE_KEY = 0x00000003
CKO_CERTIFICATE = 0x00000001
CKA_VALUE = 0x00000011
CKM_RSA_PKCS = 0x00000001
CKM_ECDSA = 0x00001041
CKU_CONTEXT_SPECIFIC = 0x00000002
CKR_USER_ALREADY_LOGGED_IN = 0x00000100
CKR_DEVICE_ERROR = 0x00000030

SHA256_PREFIX = b"\x30\x31\x30\x0d\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x01\x05\x00\x04\x20"

# PKCS#11 Type Definitions (Platform & Architecture Dependent)
if platform.system() == "Windows":
    # On Windows 64-bit, long is 32-bit (LLP64). 
    # AKİS and most Windows PKCS11 libraries use 32-bit ULONG even on x64.
    CK_ULONG = ctypes.c_uint32
else:
    # Linux and macOS 64-bit uses 64-bit ULONG (LP64).
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        CK_ULONG = ctypes.c_uint64
    else:
        CK_ULONG = ctypes.c_uint32

CK_SESSION_HANDLE = CK_ULONG
CK_SLOT_ID = CK_ULONG
CK_OBJECT_HANDLE = CK_ULONG
CK_MECHANISM_TYPE = CK_ULONG
CK_RV = CK_ULONG

IS_WINDOWS = platform.system() == "Windows"
IS_MAC = platform.system() == "Darwin"

def check_windows_scard_service():
    """Windows'ta Akıllı Kart servisinin çalışıp çalışmadığını kontrol eder."""
    if not IS_WINDOWS:
        return True
    
    import subprocess
    try:
        # sc query SCardSvr komutu ile servis durumuna bakıyoruz
        result = subprocess.run(["sc", "query", "SCardSvr"], capture_output=True, text=True, timeout=5)
        if "RUNNING" in result.stdout:
            return True
        else:
            print("\n" + "!"*60)
            print("HATA: 'Akıllı Kart' (SCardSvr) servisi çalışmıyor!")
            print("akisp11.dll bu servis olmadan yüklendiğinde çökebilir.")
            print("Lütfen 'Services.msc' üzerinden servisi başlatın.")
            print("!"*60 + "\n")
            return False
    except Exception as e:
        print(f"LOG: Servis kontrolü yapılamadı: {e}")
        return True # Hata durumunda yüklemeyi dene



# Structs
class CK_VERSION(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("major", ctypes.c_ubyte), ("minor", ctypes.c_ubyte)]

class CK_SLOT_INFO(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("slotDescription", ctypes.c_char * 64),
        ("manufacturerID", ctypes.c_char * 32),
        ("flags", CK_ULONG),
        ("hardwareVersion", CK_VERSION),
        ("firmwareVersion", CK_VERSION)
    ]

class CK_TOKEN_INFO(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("label", ctypes.c_char * 32),
        ("manufacturerID", ctypes.c_char * 32),
        ("model", ctypes.c_char * 16),
        ("serialNumber", ctypes.c_char * 16),
        ("flags", CK_ULONG),
        ("ulMaxSessionCount", CK_ULONG),
        ("ulSessionCount", CK_ULONG),
        ("ulMaxRwSessionCount", CK_ULONG),
        ("ulRwSessionCount", CK_ULONG),
        ("ulMaxPinLen", CK_ULONG),
        ("ulMinPinLen", CK_ULONG),
        ("ulTotalPublicMemory", CK_ULONG),
        ("ulFreePublicMemory", CK_ULONG),
        ("ulTotalPrivateMemory", CK_ULONG),
        ("ulFreePrivateMemory", CK_ULONG),
        ("hardwareVersion", CK_VERSION),
        ("firmwareVersion", CK_VERSION),
        ("utcTime", ctypes.c_char * 16)
    ]

class CK_ATTRIBUTE(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("type", CK_ULONG),
        ("pValue", ctypes.c_void_p),
        ("ulValueLen", CK_ULONG)
    ]

class CK_MECHANISM(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("mechanism", CK_ULONG),
        ("pParameter", ctypes.c_void_p),
        ("ulParameterLen", CK_ULONG)
    ]

print(f"LOG: Tip boyutları: CK_ULONG={ctypes.sizeof(CK_ULONG)}, CK_ATTRIBUTE={ctypes.sizeof(CK_ATTRIBUTE)}")

# Global PKCS#11 handler
_p11_lib = None

def get_p11_lib():
    global _p11_lib
    if _p11_lib is not None:
        return _p11_lib

    # PLATFORM BAZLI KÜTÜPHANE YOLLARI
    if IS_WINDOWS:
        lib_path = r"C:\Windows\System32\akisp11.dll"
        if not check_windows_scard_service():
            print("UYARI: Akıllı Kart servisi çalışmıyor. Kart takılı olmadığında bu normaldir.")
    elif IS_MAC:
        if os.path.exists("/usr/local/lib/libakisp11.dylib"):
            lib_path = "/usr/local/lib/libakisp11.dylib"
        else:
            lib_path = "/usr/lib/libakisp11.dylib"
    else:
        lib_path = "/usr/lib/libakisp11.so"

    print(f"LOG: Kullanılan Platform: {platform.system()} ({'64-bit' if ctypes.sizeof(ctypes.c_void_p) == 8 else '32-bit'})")
    print(f"LOG: Kullanılan Sürücü: {lib_path}")

    try:
        p11 = ctypes.CDLL(lib_path)
        print(f"LOG: PKCS#11 kütüphanesi başarıyla yüklendi: {lib_path}")
    except Exception as e:
        raise Exception(f"Kütüphane yüklenemedi: {e}")

    try:
        # Set function signatures for reliability on 64-bit Windows
        p11.C_Initialize.argtypes = [ctypes.c_void_p]
        p11.C_Initialize.restype = CK_RV
        
        p11.C_GetSlotList.argtypes = [ctypes.c_int, ctypes.POINTER(CK_SLOT_ID), ctypes.POINTER(CK_ULONG)]
        p11.C_GetSlotList.restype = CK_RV
        
        p11.C_GetTokenInfo.argtypes = [CK_SLOT_ID, ctypes.POINTER(CK_TOKEN_INFO)]
        p11.C_GetTokenInfo.restype = CK_RV
        
        p11.C_OpenSession.argtypes = [CK_SLOT_ID, CK_ULONG, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(CK_SESSION_HANDLE)]
        p11.C_OpenSession.restype = CK_RV
        
        p11.C_Login.argtypes = [CK_SESSION_HANDLE, CK_ULONG, ctypes.c_char_p, CK_ULONG]
        p11.C_Login.restype = CK_RV
        
        p11.C_Logout.argtypes = [CK_SESSION_HANDLE]
        p11.C_Logout.restype = CK_RV
        
        p11.C_CloseSession.argtypes = [CK_SESSION_HANDLE]
        p11.C_CloseSession.restype = CK_RV
        
        p11.C_FindObjectsInit.argtypes = [CK_SESSION_HANDLE, ctypes.POINTER(CK_ATTRIBUTE), CK_ULONG]
        p11.C_FindObjectsInit.restype = CK_RV
        
        p11.C_FindObjects.argtypes = [CK_SESSION_HANDLE, ctypes.POINTER(CK_OBJECT_HANDLE), CK_ULONG, ctypes.POINTER(CK_ULONG)]
        p11.C_FindObjects.restype = CK_RV
        
        p11.C_FindObjectsFinal.argtypes = [CK_SESSION_HANDLE]
        p11.C_FindObjectsFinal.restype = CK_RV
        
        p11.C_GetAttributeValue.argtypes = [CK_SESSION_HANDLE, CK_OBJECT_HANDLE, ctypes.POINTER(CK_ATTRIBUTE), CK_ULONG]
        p11.C_GetAttributeValue.restype = CK_RV
        
        p11.C_SignInit.argtypes = [CK_SESSION_HANDLE, ctypes.POINTER(CK_MECHANISM), CK_OBJECT_HANDLE]
        p11.C_SignInit.restype = CK_RV
        
        p11.C_Sign.argtypes = [CK_SESSION_HANDLE, ctypes.c_char_p, CK_ULONG, ctypes.c_char_p, ctypes.POINTER(CK_ULONG)]
        p11.C_Sign.restype = CK_RV

        r_init = p11.C_Initialize(None)
        if r_init != 0 and r_init != 0x00000191: # CKR_CRYPTOKI_ALREADY_INITIALIZED
            print(f"UYARI: C_Initialize hata kodu döndürdü: {hex(r_init)}")
            
        _p11_lib = p11
        return _p11_lib
    except Exception as e:
        raise Exception(f"PKCS#11 başlatma/imza tanımlama sırasında hata: {e}")

def build_cms(cert_der: bytes, sig_bytes: bytes, signed_attrs_set: bytes, algo: str = 'sha256_rsa') -> bytes:
    cert = x509.Certificate.load(cert_der)

    signer_info = cms.SignerInfo({
        'version': 'v1',
        'sid': cms.SignerIdentifier({
            'issuer_and_serial_number': cms.IssuerAndSerialNumber({
                'issuer': cert.issuer,
                'serial_number': cert.serial_number,
            })
        }),
        'digest_algorithm': cms.DigestAlgorithm({'algorithm': 'sha256'}),
        'signed_attrs': cms.CMSAttributes.load(signed_attrs_set),
        'signature_algorithm': cms.SignedDigestAlgorithm({'algorithm': algo}),
        'signature': sig_bytes
    })

    signed_data = cms.SignedData({
        'version': 'v1',
        'digest_algorithms': cms.DigestAlgorithms([
            cms.DigestAlgorithm({'algorithm': 'sha256'})
        ]),
        'encap_content_info': cms.ContentInfo({
            'content_type': 'data'
            # detached signature: content is None
        }),
        'certificates': cms.CertificateSet([
            cms.CertificateChoices({
                'certificate': cert
            })
        ]),
        'signer_infos': cms.SignerInfos([signer_info])
    })

    content_info = cms.ContentInfo({
        'content_type': 'signed_data',
        'content': signed_data
    })

    return content_info.dump()

def ecdsa_raw_to_der(raw_sig: bytes) -> bytes:
    if len(raw_sig) % 2 != 0:
        raise ValueError("Invalid ECDSA raw signature length")
    half = len(raw_sig) // 2
    r_bytes = raw_sig[:half]
    s_bytes = raw_sig[half:]
    r = int.from_bytes(r_bytes, 'big')
    s = int.from_bytes(s_bytes, 'big')

    def to_asn1_int(val):
        b = val.to_bytes((val.bit_length() + 7) // 8 or 1, 'big')
        if b[0] & 0x80:
            b = b'\x00' + b
        return bytes([0x02, len(b)]) + b

    r_asn1 = to_asn1_int(r)
    s_asn1 = to_asn1_int(s)
    seq = r_asn1 + s_asn1
    return bytes([0x30, len(seq)]) + seq

def p11_get_cert(p11_lib, session, slot_id_val=None) -> Optional[bytes]:
    try:
        print(f"LOG: Sertifika aranıyor (Session: {session.value})...")
        cv = CK_ULONG(CKO_CERTIFICATE)
        print(f"LOG: Arama kriteri hazırlanıyor (CKA_CLASS={CKA_CLASS})...")
        tmpl = (CK_ATTRIBUTE * 1)(
            CK_ATTRIBUTE(CK_ULONG(CKA_CLASS), ctypes.cast(ctypes.byref(cv), ctypes.c_void_p), CK_ULONG(ctypes.sizeof(cv)))
        )
        r = p11_lib.C_FindObjectsInit(session, tmpl, CK_ULONG(1))
        if r != 0: 
            print(f"LOG: C_FindObjectsInit hata: {hex(r)}")
            return None
        
        objs = (CK_OBJECT_HANDLE * 10)()
        cnt = CK_ULONG(0)
        r = p11_lib.C_FindObjects(session, objs, CK_ULONG(10), ctypes.byref(cnt))
        if r != 0: 
            print(f"LOG: C_FindObjects hata: {hex(r)}")
            p11_lib.C_FindObjectsFinal(session)
            return None
            
        p11_lib.C_FindObjectsFinal(session)
        print(f"LOG: {cnt.value} adet sertifika objesi bulundu.")
        
        if cnt.value == 0:
            return None
 
        print(f"LOG: Sertifika içeriği okunuyor (Handle: {objs[0]})...")
        size_tmpl = (CK_ATTRIBUTE * 1)(CK_ATTRIBUTE(CK_ULONG(CKA_VALUE), None, CK_ULONG(0)))
        r = p11_lib.C_GetAttributeValue(session, objs[0], size_tmpl, CK_ULONG(1))
        if r != 0:
            print(f"LOG: C_GetAttributeValue (size) hata: {hex(r)}")
            return None
        
        sz = size_tmpl[0].ulValueLen
        print(f"LOG: Sertifika boyutu: {sz} bayt")
        buf = ctypes.create_string_buffer(sz)
        val_tmpl = (CK_ATTRIBUTE * 1)(CK_ATTRIBUTE(CK_ULONG(CKA_VALUE), ctypes.cast(buf, ctypes.c_void_p), CK_ULONG(sz)))
        r = p11_lib.C_GetAttributeValue(session, objs[0], val_tmpl, CK_ULONG(1))
        if r != 0:
            print(f"LOG: C_GetAttributeValue (data) hata: {hex(r)}")
            return None
        
        return bytes(buf.raw[:sz])
    except Exception as e:
        print("Cert fetch err:", e)
        import traceback; traceback.print_exc()
        return None

@app.route('/list-certs', methods=['GET'])
def list_certs():
    try:
        p11 = get_p11_lib()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

    slots = (CK_SLOT_ID * 10)()
    count = CK_ULONG(10)
    r = p11.C_GetSlotList(1, slots, ctypes.byref(count))
    if r != 0:
        return jsonify({"success": False, "error": f"C_GetSlotList: {hex(r)}"})

    certs = []
    for i in range(count.value):
        tinfo = CK_TOKEN_INFO()
        if p11.C_GetTokenInfo(slots[i], ctypes.byref(tinfo)) == 0:
            lbl = tinfo.label.decode('utf-8', 'ignore').strip()
            if lbl:
                certs.append({"slotId": slots[i], "label": lbl})

    return jsonify({"success": True, "certs": certs})

@app.route('/sign', methods=['POST'])
def sign():
    import datetime
    
    data        = request.json
    pin         = str(data.get('pin', ''))
    slot_id_val = int(data.get('slotId', 0))
    raw_content = base64.b64decode(data.get('data'))
    pin_bytes   = pin.encode()

    try:
        p11 = get_p11_lib()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

    session = CK_SESSION_HANDLE(0)
    try:
        slot = CK_SLOT_ID(slot_id_val)
        print(f"LOG: Oturum açılıyor (Slot: {slot.value})...")
        r = p11.C_OpenSession(slot, CK_ULONG(0x06), None, None, ctypes.byref(session))
        if r != 0: 
            print(f"LOG: C_OpenSession hata: {hex(r)}")
            return jsonify({"success": False, "error": f"C_OpenSession: {hex(r)}"})

        print(f"LOG: Giriş yapılıyor (Session: {session.value})...")
        r = p11.C_Login(session, CK_ULONG(CKU_USER), ctypes.c_char_p(pin_bytes), CK_ULONG(len(pin_bytes)))
        if r not in (0x00, CKR_USER_ALREADY_LOGGED_IN):
            print(f"LOG: C_Login hata: {hex(r)}")
            return jsonify({"success": False, "error": f"Yanlış PIN. Hata: {hex(r)}"})

        # GET CERTIFICATE FIRST
        cert_der = p11_get_cert(p11, session)
        if not cert_der: 
            print("LOG: Sertifika verisi alınamadı.")
            return jsonify({"success": False, "error": "Sertifika okunamadı"})
        
        print("LOG: Sertifika ayrıştırılıyor...")
        cert = x509.Certificate.load(cert_der)
        cert_hash = hashlib.sha256(cert.dump()).digest()

        # CREATE SIGNED ATTRS INCLUDING ESSCertIDv2
        scv2_dict = {
            'certs': [
                {
                    'hash_algorithm': {'algorithm': 'sha256'},
                    'cert_hash': cert_hash,
                    'issuer_serial': {
                        'issuer': [
                            x509.GeneralName({'directory_name': cert.issuer})
                        ],
                        'serial_number': cert.serial_number
                    }
                }
            ]
        }

        content_digest = hashlib.sha256(raw_content).digest()
        signed_attrs = cms.CMSAttributes([
            cms.CMSAttribute({
                'type': 'content_type',
                'values': ['data'],
            }),
            cms.CMSAttribute({
                'type': 'signing_time',
                'values': [cms.Time({'utc_time': core.UTCTime(datetime.datetime.now(datetime.timezone.utc))})],
            }),
            cms.CMSAttribute({
                'type': 'message_digest',
                'values': [content_digest],
            }),
            cms.CMSAttribute({
                'type': 'signing_certificate_v2',
                'values': [scv2_dict]
            })
        ])
        
        sa_set = signed_attrs.dump()
        # SIGNING LOGIC WITH FALLBACKS
        sa_hash = hashlib.sha256(sa_set).digest()
        
        # Payloads to try: (Label, Mechanism, Data, NeedContextLogin)
        payloads = [
            ("RSA PKCS + DigestInfo", CKM_RSA_PKCS, SHA256_PREFIX + sa_hash, False),
            ("RSA PKCS + Raw Hash",   CKM_RSA_PKCS, sa_hash, False),
            ("ECDSA + Raw Hash",      CKM_ECDSA,    sa_hash, False),
            # Try again with context specific login if needed
            ("RSA PKCS + DigestInfo (Context Login)", CKM_RSA_PKCS, SHA256_PREFIX + sa_hash, True),
            ("RSA PKCS + Raw Hash (Context Login)",   CKM_RSA_PKCS, sa_hash, True),
            ("ECDSA + Raw Hash (Context Login)",      CKM_ECDSA,    sa_hash, True),
        ]

        last_error = "Bilinmeyen hata"
        sig_data = None
        used_label = ""
        
        # Ana oturumu kapat ki kartın durumu temizlensin
        try: p11.C_CloseSession(session)
        except: pass
        session.value = 0 # İşaretçi sıfırla

        for label, mech_id, payload, context_login in payloads:
            print(f"LOG: Deneniyor: {label} (ContextLogin={context_login})")
            
            test_session = CK_SESSION_HANDLE(0)
            r_open = p11.C_OpenSession(slot, CK_ULONG(0x06), None, None, ctypes.byref(test_session))
            if r_open != 0:
                last_error = f"C_OpenSession {label}: {hex(r_open)}"
                continue
                
            p11.C_Login(test_session, CK_ULONG(CKU_USER), ctypes.c_char_p(pin_bytes), CK_ULONG(len(pin_bytes)))
            
            if context_login:
                p11.C_Login(test_session, CK_ULONG(CKU_CONTEXT_SPECIFIC), ctypes.c_char_p(pin_bytes), CK_ULONG(len(pin_bytes)))
            
            # Özel anahtarı bu oturumda tekrar bul
            cv_priv = CK_ULONG(CKO_PRIVATE_KEY)
            tmpl_priv = (CK_ATTRIBUTE * 1)(
                CK_ATTRIBUTE(CK_ULONG(0x00000000), ctypes.cast(ctypes.byref(cv_priv), ctypes.c_void_p), ctypes.sizeof(cv_priv))
            )
            p11.C_FindObjectsInit(test_session, tmpl_priv, CK_ULONG(1))
            objs_priv = (CK_OBJECT_HANDLE * 1)()
            cnt_priv = CK_ULONG(0)
            p11.C_FindObjects(test_session, objs_priv, CK_ULONG(1), ctypes.byref(cnt_priv))
            p11.C_FindObjectsFinal(test_session)
            
            if cnt_priv.value == 0:
                last_error = f"{label} için özel anahtar bulunamadı"
                p11.C_CloseSession(test_session)
                continue
                
            test_obj = objs_priv[0]
            
            try:
                mech = CK_MECHANISM(CK_ULONG(mech_id), None, 0)
                r_init = p11.C_SignInit(test_session, ctypes.byref(mech), test_obj)
                if r_init != 0:
                    print(f"LOG: C_SignInit ({label}) hata: {hex(r_init)}")
                    last_error = f"C_SignInit {label}: {hex(r_init)}"
                    p11.C_CloseSession(test_session)
                    continue

                slen = CK_ULONG(0)
                # 1. Adım: İmza boyutunu öğren (buffer'ı None olarak yolla)
                r_sign_len = p11.C_Sign(test_session, payload, CK_ULONG(len(payload)), None, ctypes.byref(slen))
                
                # PKCS#11'e göre ilk çağrı CKR_OK (0) veya CKR_BUFFER_TOO_SMALL (0x150) dönebilir
                if r_sign_len == 0 or r_sign_len == 0x150:
                    if slen.value > 0:
                        buf = ctypes.create_string_buffer(slen.value)
                        # 2. Adım: Gerçek imzalama işlemini gerçekleştir
                        r_sign = p11.C_Sign(test_session, payload, CK_ULONG(len(payload)), buf, ctypes.byref(slen))
                        
                        if r_sign == 0:
                            print(f"LOG: BAŞARILI! ({label})")
                            sig_data = buf.raw[:slen.value]
                            used_label = label
                            p11.C_CloseSession(test_session)
                            break
                        else:
                            print(f"LOG: C_Sign Adım 2 ({label}) hata: {hex(r_sign)}")
                            last_error = f"C_Sign {label}: {hex(r_sign)}"
                            if r_sign == CKR_DEVICE_ERROR:
                                print("LOG: 0x30 hatası algılandı, alternatif yöntem denenecek.")
                    else:
                        print(f"LOG: C_Sign ({label}) boyutu 0 döndürdü")
                        last_error = f"C_Sign {label}: Boyut 0 döndü"
                else:
                    print(f"LOG: C_Sign Adım 1 ({label}) hata: {hex(r_sign_len)}")
                    last_error = f"C_Sign {label}: {hex(r_sign_len)}"
                    if r_sign_len == CKR_DEVICE_ERROR:
                        print("LOG: 0x30 hatası algılandı, alternatif yöntem denenecek.")
            except Exception as e:
                print(f"LOG: {label} sırasında istisna: {e}")
                last_error = str(e)
                
            p11.C_CloseSession(test_session)

        if not sig_data:
            return jsonify({"success": False, "error": f"İmzalama başarısız. Son hata: {last_error}"})

        if "ECDSA" in used_label:
            sig_final = ecdsa_raw_to_der(sig_data)
            algo_name = 'sha256_ecdsa'
        else:
            sig_final = sig_data
            algo_name = 'sha256_rsa'
        
        cms_bytes = build_cms(cert_der, sig_final, sa_set, algo_name)
        
        try:
            # Extract full certificate details
            cn = cert.subject.native.get('common_name', 'Bilinmeyen Kullanıcı')
            issuer = cert.issuer.native.get('common_name', 'Bilinmeyen Sağlayıcı')
            serial = str(cert.serial_number)
            identity_no = cert.subject.native.get('serial_number', '')
            valid_from = cert.not_valid_before.isoformat() if cert.not_valid_before else ''
            valid_to = cert.not_valid_after.isoformat() if cert.not_valid_after else ''
            
            cert_details = {
                "subject": cn,
                "issuer": issuer,
                "serial": serial,
                "identityNo": identity_no,
                "validFrom": valid_from,
                "validTo": valid_to,
                "method": used_label
            }
        except:
            cn = 'E-İmza Sahibi'
            cert_details = {"subject": cn, "method": used_label}

        return jsonify({
            "success": True, 
            "signature": base64.b64encode(cms_bytes).decode(),
            "signerName": cn,
            "certDetails": cert_details
        })

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})
    finally:
        if session.value != 0:
            try: p11.C_Logout(session)
            except: pass
            try: p11.C_CloseSession(session)
            except: pass

@app.route('/parse_signature', methods=['POST'])
def parse_signature():
    """
    Parses a base64 encoded CMS/PKCS#7 signature and extracts the signer's certificate details.
    This doesn't require a smartcard or PKCS11 session.
    """
    try:
        data = request.get_json()
        if not data or 'signature' not in data:
            return jsonify({"success": False, "error": "No signature provided"}), 400
            
        signature_bytes = base64.b64decode(data['signature'])
        from asn1crypto import cms
        
        content_info = cms.ContentInfo.load(signature_bytes)
        signed_data = content_info['content']
        
        cert_choices = signed_data['certificates']
        if not cert_choices:
            return jsonify({"success": False, "error": "No certificates found in signature"}), 400
            
        cert = cert_choices[0].chosen
        
        cn = cert.subject.native.get('common_name', 'Bilinmeyen Kullanıcı')
        issuer = cert.issuer.native.get('common_name', 'Bilinmeyen Sağlayıcı')
        serial = str(cert.serial_number)
        identity_no = cert.subject.native.get('serial_number', '')
        valid_from = cert.not_valid_before.isoformat() if cert.not_valid_before else ''
        valid_to = cert.not_valid_after.isoformat() if cert.not_valid_after else ''
        
        cert_details = {
            "subject": cn,
            "issuer": issuer,
            "serial": serial,
            "identityNo": identity_no,
            "validFrom": valid_from,
            "validTo": valid_to
        }
        
        return jsonify({
            "success": True,
            "signerName": cn,
            "certDetails": cert_details
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=False)
