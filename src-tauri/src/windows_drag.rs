use std::{
    mem::{size_of, size_of_val},
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    ptr,
};

use windows::Win32::{
    Foundation::{
        GlobalFree, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS,
        DV_E_FORMATETC, E_NOTIMPL, HGLOBAL, OLE_E_ADVISENOTSUPPORTED, S_OK,
    },
    System::{
        Com::{
            IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, DATADIR_GET,
            DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GHND},
        Ole::{
            DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize, CF_HDROP,
            DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE, DROPEFFECT_NONE,
        },
        SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
    },
    UI::Shell::{SHCreateDataObject, SHCreateStdEnumFmtEtc, DROPFILES},
};
use windows_core::{implement, Error, Ref, Result, BOOL, HRESULT};

pub fn start(paths: Vec<PathBuf>) -> std::result::Result<(), String> {
    unsafe { OleInitialize(None) }.map_err(|error| error.to_string())?;
    let result = run_drag(paths).map_err(|error| error.to_string());
    unsafe { OleUninitialize() };
    result
}

fn run_drag(paths: Vec<PathBuf>) -> Result<()> {
    let mut file_list = Vec::new();
    for path in paths {
        file_list.extend(path.as_os_str().encode_wide());
        file_list.push(0);
    }
    file_list.push(0);

    let inner = unsafe { SHCreateDataObject(None, None, None::<&IDataObject>) }?;
    let data: IDataObject = FileDropDataObject { file_list, inner }.into();
    let source: IDropSource = FileDropSource.into();
    let mut effect = DROPEFFECT_NONE;

    match unsafe {
        DoDragDrop(
            &data,
            &source,
            DROPEFFECT_COPY | DROPEFFECT_MOVE,
            &mut effect,
        )
    } {
        DRAGDROP_S_DROP if effect != DROPEFFECT_NONE => Ok(()),
        DRAGDROP_S_DROP | DRAGDROP_S_CANCEL => Ok(()),
        error => Err(Error::from_hresult(error)),
    }
}

#[implement(IDropSource)]
struct FileDropSource;

impl IDropSource_Impl for FileDropSource_Impl {
    fn QueryContinueDrag(&self, escape_pressed: BOOL, key_state: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape_pressed.as_bool() {
            DRAGDROP_S_CANCEL
        } else if key_state & MK_LBUTTON == MODIFIERKEYS_FLAGS(0) {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }

    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

#[implement(IDataObject)]
struct FileDropDataObject {
    file_list: Vec<u16>,
    inner: IDataObject,
}

const FILE_DROP_FORMAT: FORMATETC = FORMATETC {
    cfFormat: CF_HDROP.0,
    ptd: ptr::null_mut(),
    dwAspect: DVASPECT_CONTENT.0,
    lindex: -1,
    tymed: TYMED_HGLOBAL.0 as u32,
};

fn is_file_drop_format(format: *const FORMATETC) -> bool {
    unsafe { format.as_ref() }.is_some_and(|format| {
        format.cfFormat == FILE_DROP_FORMAT.cfFormat
            && format.dwAspect == FILE_DROP_FORMAT.dwAspect
            && format.tymed & FILE_DROP_FORMAT.tymed != 0
    })
}

impl FileDropDataObject_Impl {
    fn create_file_drop_data(&self) -> Result<HGLOBAL> {
        let header_size = size_of::<DROPFILES>();
        let file_data_size = size_of_val(self.file_list.as_slice());
        let memory = unsafe { GlobalAlloc(GHND, header_size + file_data_size)? };
        let pointer = unsafe { GlobalLock(memory).cast::<u8>() };
        if pointer.is_null() {
            let error = Error::from_thread();
            let _ = unsafe { GlobalFree(Some(memory)) };
            return Err(error);
        }

        unsafe {
            pointer.cast::<DROPFILES>().write_unaligned(DROPFILES {
                pFiles: header_size as u32,
                fWide: BOOL(1),
                ..Default::default()
            });
            ptr::copy_nonoverlapping(
                self.file_list.as_ptr().cast::<u8>(),
                pointer.add(header_size),
                file_data_size,
            );
            let _ = GlobalUnlock(memory);
        }
        Ok(memory)
    }
}

impl IDataObject_Impl for FileDropDataObject_Impl {
    fn GetData(&self, format: *const FORMATETC) -> Result<STGMEDIUM> {
        if !is_file_drop_format(format) {
            return unsafe { self.inner.GetData(format) };
        }
        Ok(STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 {
                hGlobal: self.create_file_drop_data()?,
            },
            pUnkForRelease: std::mem::ManuallyDrop::new(None),
        })
    }

    fn GetDataHere(&self, format: *const FORMATETC, medium: *mut STGMEDIUM) -> Result<()> {
        if is_file_drop_format(format) {
            return Err(DV_E_FORMATETC.into());
        }
        unsafe { self.inner.GetDataHere(format, medium) }
    }

    fn QueryGetData(&self, format: *const FORMATETC) -> HRESULT {
        if is_file_drop_format(format) {
            S_OK
        } else {
            unsafe { self.inner.QueryGetData(format) }
        }
    }

    fn GetCanonicalFormatEtc(
        &self,
        format: *const FORMATETC,
        canonical: *mut FORMATETC,
    ) -> HRESULT {
        unsafe { self.inner.GetCanonicalFormatEtc(format, canonical) }
    }

    fn SetData(
        &self,
        format: *const FORMATETC,
        medium: *const STGMEDIUM,
        release: BOOL,
    ) -> Result<()> {
        unsafe { self.inner.SetData(format, medium, release.as_bool()) }
    }

    fn EnumFormatEtc(&self, direction: u32) -> Result<IEnumFORMATETC> {
        if direction != DATADIR_GET.0 as u32 {
            return Err(E_NOTIMPL.into());
        }
        unsafe { SHCreateStdEnumFmtEtc(&[FILE_DROP_FORMAT]) }
    }

    fn DAdvise(&self, format: *const FORMATETC, advf: u32, sink: Ref<IAdviseSink>) -> Result<u32> {
        unsafe { self.inner.DAdvise(format, advf, sink.as_ref()) }
    }

    fn DUnadvise(&self, connection: u32) -> Result<()> {
        unsafe { self.inner.DUnadvise(connection) }
    }

    fn EnumDAdvise(&self) -> Result<IEnumSTATDATA> {
        Err(OLE_E_ADVISENOTSUPPORTED.into())
    }
}
