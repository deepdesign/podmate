import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FileBrowser from '../components/FileBrowser';
import MappingGrid from '../components/MappingGrid';
import MetadataPanel from '../components/MetadataPanel';
import type { TemplateInfo, UploadedFile, VariantAssignment, CreateFromTemplateBody } from '../lib/types';

export default function Mapping() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedVariants, setSelectedVariants] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Map<string, VariantAssignment>>(new Map());
  const [metadata, setMetadata] = useState<Partial<CreateFromTemplateBody>>({});

  useEffect(() => {
    const stored = sessionStorage.getItem('templates');
    if (stored) {
      setTemplates(JSON.parse(stored));
    } else {
      navigate('/');
    }
  }, [navigate]);

  const handleFilesAdded = (files: File[]) => {
    // Convert File[] to UploadedFile[] - in a real implementation, these would need to be uploaded first
    // For now, this is a type compatibility fix
    const uploadedFiles: UploadedFile[] = files.map(file => ({
      fileId: file.name,
      publicUrl: URL.createObjectURL(file),
      originalName: file.name,
      file: file,
      sourceType: 'local' as const,
    }));
    setUploadedFiles(prev => [...prev, ...uploadedFiles]);
  };

  const handleMappingChange = (newMapping: Map<string, VariantAssignment>) => {
    setMapping(newMapping);
  };

  const handleMetadataChange = (newMetadata: Partial<CreateFromTemplateBody>) => {
    setMetadata(newMetadata);
  };

  const handleContinue = () => {
    // Store all mapping data for review page
    sessionStorage.setItem('uploadedFiles', JSON.stringify(uploadedFiles));
    sessionStorage.setItem('selectedVariants', JSON.stringify(selectedVariants));
    sessionStorage.setItem('mapping', JSON.stringify(Array.from(mapping.entries())));
    sessionStorage.setItem('metadata', JSON.stringify(metadata));
    navigate('/review');
  };

  return (
    <div className="space-y-6">
      <FileBrowser onFilesAdded={handleFilesAdded} />
      
      <MappingGrid
        templates={templates}
        uploadedFiles={uploadedFiles}
        selectedVariants={selectedVariants}
        onVariantsChange={setSelectedVariants}
        onMappingChange={handleMappingChange}
      />

      <MetadataPanel
        initialTitle={metadata.title}
        initialDescription={metadata.description}
        onChange={handleMetadataChange}
      />

      <div className="flex justify-end">
        <button
          onClick={handleContinue}
          disabled={selectedVariants.length === 0 || uploadedFiles.length === 0}
          className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Review & Create →
        </button>
      </div>
    </div>
  );
}

